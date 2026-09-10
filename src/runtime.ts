import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import {
  NODE_KINDS,
  RELATIONSHIP_TYPES,
  parseInstant,
  validateApplicability,
} from "./domain.ts";
import type {
  Applicability,
  ChangeRecord,
  ContradictionRecord,
  JustificationRecord,
  KnowledgeBaseRecord,
  NodeFields,
  NodeKind,
  NodeRecord,
  PremiseGroup,
  ProjectState,
  RelationshipRecord,
  RelationshipType,
  ReviewRecord,
  ScopeChange,
  SourceAvailability,
  SourceObservation,
  SourceRecord
} from "./domain.ts";
import { ensureHistory, PostCommitError, readHistory, transact } from "./storage.ts";
import { FileKnowledgeProvider, ProviderError } from "./provider.ts";
import type { ProviderFetch } from "./provider.ts";
import { ProjectionError, writeProjection } from "./serializer.ts";
import { handleRebuild } from "./recovery.ts";
import { buildSupportTree, supportNodeIds, supportProvenance } from "./support-tree.ts";
import type { SupportTree } from "./support-tree.ts";
import { validateRuntimeRequest } from "./requests.ts";

export type RuntimeErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "INVALID_SCOPE"
  | "SCOPE_VIOLATION"
  | "INVALID_NODE"
  | "INVALID_JUSTIFICATION"
  | "SUPPORT_CYCLE"
  | "INVALID_RELATIONSHIP"
  | "INVALID_PROVENANCE"
  | "CONFLICT"
  | "REVIEW_REQUIRED"
  | "PROJECTION_DRIFT"
  | "PROJECTION_FAILED"
  | "AUDIT_FAILED";

export class RuntimeError extends Error {
  readonly name = "RuntimeError";
  readonly code: RuntimeErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: RuntimeErrorCode, message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.details = details;
  }
}

type ActorRequest = { actor: string; at?: string; expectedRevision?: number };
export type RecordLinkRequest = { readonly to: string; readonly type: RelationshipType; readonly rationale?: string };

export type RuntimeRequest =
  | { op: "knowledge_bases"; kb?: string }
  | { op: "create_kb"; id: string; title: string; parent?: string; actor: string; at?: string; expectedRevision?: number }
  | ({ op: "record"; id?: string; kb: string; kind: NodeKind; title: string; body?: string; basis?: string[]; basisGroups?: string[][]; fields?: NodeFields; links?: RecordLinkRequest[]; applicability?: Applicability } & ActorRequest)
  | ({ op: "justify"; conclusion: string; groups: (string[] | { premises: string[] })[]; rationale: string; kb?: string; title?: string; applicability?: Applicability } & ActorRequest)
  | ({ op: "relate"; from: string; to: string; type: RelationshipType; kb?: string; rationale?: string } & ActorRequest)
  | ({ op: "capture_source"; locator: string; kb?: string; title?: string; sourceId?: string } & ActorRequest)
  | { op: "inspect_source"; sourceId?: string; locator?: string; kb?: string }
  | { op: "evidence"; evidenceId?: string; sourceId?: string; kb?: string }
  | { op: "why"; nodeId: string; kb?: string; revision?: number; evaluationTime?: string }
  | { op: "impact"; nodeId: string; kb?: string; evaluationTime?: string }
  | { op: "trace"; nodeId: string; direction?: "upstream" | "downstream"; kb?: string; budget?: number; evaluationTime?: string }
  | ({ op: "refresh"; sourceIds?: string[]; kb?: string; evaluationTime?: string } & ActorRequest)
  | { op: "changed"; sourceId?: string; kb?: string }
  | { op: "context"; nodeId?: string; query?: string; kb?: string; budget?: number; evaluationTime?: string }
  | { op: "search"; query: string; kb?: string; budget?: number }
  | ({ op: "contradict"; left: string; right: string; rationale: string } & ActorRequest)
  | { op: "conflicts"; kb?: string }
  | ({ op: "review"; reviewId?: string; status?: "open" | "closed"; rationale?: string; kb?: string } & Partial<ActorRequest>)
  | ({ op: "promote"; nodeId: string; reason?: string; conflicts?: string[] } & ActorRequest)
  | ({ op: "resolve_conflict"; contradictionId: string; resolution: "supersession" | "different_scope" | "different_time" | "source_error" | "unresolved"; rationale: string } & ActorRequest)
  | { op: "audit"; kb?: string; evaluationTime?: string }
  | ({ op: "rebuild" } & Partial<ActorRequest>)
  | { op: "export"; kb?: string; outputDir?: string; repair?: boolean };

export type RuntimeResponse<T = unknown> = {
  readonly revision: number;
  readonly data: T;
};

async function canonicalRoot(input: string): Promise<string> {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new RuntimeError("INVALID_REQUEST", "project root must be a nonempty path");
  }
  let root: string;
  try {
    root = await realpath(input);
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    throw new RuntimeError("INVALID_REQUEST", `project root is unavailable: ${input}`, undefined, { cause: error });
  }
  return root;
}

function atTime(value: string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    throw new RuntimeError("INVALID_REQUEST", "at must be an offset-bearing ISO timestamp");
  }
  return new Date(parsed).toISOString();
}

function requireActor(request: ActorRequest): string {
  if (typeof request.actor !== "string" || request.actor.trim().length === 0) {
    throw new RuntimeError("INVALID_REQUEST", "mutations require a nonempty actor");
  }
  return request.actor.trim();
}

function kbDescriptor(root: string, kb: KnowledgeBaseRecord, inherited: boolean) {
  return { ...kb, inherited, root: join(root, "kb", kb.id) };
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

async function ensureChildDirectory(root: string, id: string): Promise<void> {
  const kbRoot = join(root, "kb");
  const kbInfo = await lstat(kbRoot).catch(() => undefined);
  if (!kbInfo || kbInfo.isSymbolicLink() || !kbInfo.isDirectory()) {
    throw new RuntimeError("INVALID_SCOPE", "project kb directory is missing or escapes through a symlink");
  }
  const child = join(kbRoot, id);
  const childInfo = await lstat(child).catch(() => undefined);
  if (childInfo) {
    if (childInfo.isSymbolicLink() || !childInfo.isDirectory()) throw new RuntimeError("INVALID_SCOPE", `knowledge base path is not a directory: ${id}`);
    return;
  }
  await mkdir(child);
}

function findKb(state: ProjectState, id: string): KnowledgeBaseRecord {
  const kbs = state.kbs as Record<string, KnowledgeBaseRecord>;
  const kb = hasOwn(kbs as Record<string, unknown>, id) ? kbs[id] : undefined;
  if (!kb) throw new RuntimeError("NOT_FOUND", `knowledge base not found: ${id}`, { id });
  return kb;
}

type MutableState = {
  -readonly [K in keyof ProjectState]: ProjectState[K] extends Readonly<Record<string, infer V>>
    ? Record<string, V>
    : ProjectState[K] extends readonly (infer V)[]
      ? V[]
      : ProjectState[K];
};

type MutableNodeFields = { -readonly [K in keyof NodeFields]: NodeFields[K] };

function mutableState(state: ProjectState): MutableState {
  return state as unknown as MutableState;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) throw new RuntimeError("INVALID_NODE", `${field} must be a UUID`);
  return value;
}

function nodeById(state: ProjectState, id: string): NodeRecord {
  const nodes = state.nodes as Record<string, NodeRecord>;
  if (!hasOwn(nodes as Record<string, unknown>, id)) throw new RuntimeError("NOT_FOUND", `node not found: ${id}`, { id });
  return nodes[id];
}

function visibleNode(state: ProjectState, id: string, kb?: string): NodeRecord {
  const node = nodeById(state, id);
  if (kb !== undefined) {
    findKb(state, kb);
    if (node.kb !== "shared" && node.kb !== kb) {
      throw new RuntimeError("SCOPE_VIOLATION", `node ${id} is outside knowledge base ${kb}`, { id, kb });
    }
  }
  return node;
}

function effectiveKb(state: ProjectState, nodeId: string, requested?: string): string {
  if (requested !== undefined) {
    findKb(state, requested);
    visibleNode(state, nodeId, requested);
    return requested;
  }
  return nodeById(state, nodeId).kb;
}

function cloneFields(fields: NodeFields | undefined): MutableNodeFields {
  return fields === undefined ? {} : structuredClone(fields);
}

function normalizeGroups(value: readonly (string[] | { premises: string[] })[]): PremiseGroup[] {
  if (!Array.isArray(value) || value.length === 0) throw new RuntimeError("INVALID_JUSTIFICATION", "at least one nonempty premise group is required");
  return value.map((group, index) => {
    const premises = Array.isArray(group) ? group : group && typeof group === "object" ? group.premises : undefined;
    if (!Array.isArray(premises) || premises.length === 0 || premises.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new RuntimeError("INVALID_JUSTIFICATION", `premise group ${index + 1} must contain at least one node ID`);
    }
    const unique = [...new Set(premises)];
    if (unique.length !== premises.length) throw new RuntimeError("INVALID_JUSTIFICATION", `premise group ${index + 1} repeats a node ID`);
    return { id: randomUUID(), premises: unique };
  });
}

function basisGroups(request: { basis?: string[]; basisGroups?: string[][] }): PremiseGroup[] {
  if (request.basisGroups !== undefined) return normalizeGroups(request.basisGroups);
  if (request.basis !== undefined) return normalizeGroups([request.basis]);
  throw new RuntimeError("INVALID_JUSTIFICATION", "decision and artifact records require a nonempty basis or basisGroups");
}

function assertRationale(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new RuntimeError("INVALID_JUSTIFICATION", "rationale must be nonempty");
  return value.trim();
}

function supportReachable(state: ProjectState, start: string, target: string, seen = new Set<string>()): boolean {
  if (start === target) return true;
  if (seen.has(start)) return false;
  seen.add(start);
  for (const justification of Object.values(state.justifications)) {
    if (justification.conclusion !== start) continue;
    for (const group of justification.groups) {
      for (const premise of group.premises) if (supportReachable(state, premise, target, seen)) return true;
    }
  }
  return false;
}

function ensureNoSupportCycle(state: ProjectState, conclusion: string, groups: readonly PremiseGroup[]): void {
  for (const group of groups) {
    for (const premise of group.premises) {
      // The proposed edge is conclusion -> premise. A cycle exists when the
      // existing support graph already reaches the conclusion from that
      // premise; traverse premise -> ... -> conclusion before committing.
      if (supportReachable(state, premise, conclusion)) throw new RuntimeError("SUPPORT_CYCLE", `justification would create a support cycle through ${premise}`, { conclusion, premise });
    }
  }
}

function currentSourceForNode(state: ProjectState, node: NodeRecord): SourceRecord | undefined {
  const sourceId = node.fields?.sourceId;
  if (typeof sourceId !== "string") return undefined;
  const sources = state.sources as Record<string, SourceRecord>;
  return hasOwn(sources as Record<string, unknown>, sourceId) ? sources[sourceId] : undefined;
}

function observationForEvidence(state: ProjectState, node: NodeRecord): SourceObservation | undefined {
  const observationId = node.fields?.observationId;
  if (typeof observationId !== "string") return undefined;
  const observations = state.observations as Record<string, SourceObservation>;
  return hasOwn(observations as Record<string, unknown>, observationId) ? observations[observationId] : undefined;
}

async function commitMutation<T>(root: string, actor: string, action: string, expectedRevision: number | undefined, mutate: (state: ProjectState, nextRevision: number) => { state: ProjectState; value: T }): Promise<RuntimeResponse<T>> {
  const current = await readHistory(root);
  if (expectedRevision !== undefined && expectedRevision !== current.revision.revision) {
    throw new RuntimeError("CONFLICT", `expected revision ${expectedRevision} but current revision is ${current.revision.revision}`, { expectedRevision, currentRevision: current.revision.revision });
  }
  try {
    const transaction = await transact(root, actor, action, (state, nextRevision) => {
      if (expectedRevision !== undefined && expectedRevision !== nextRevision - 1) throw new RuntimeError("CONFLICT", `expected revision ${expectedRevision} but current revision is ${nextRevision - 1}`, { expectedRevision, currentRevision: nextRevision - 1 });
      return mutate(state, nextRevision);
    }, async (revision) => {
      await writeProjection(root, revision.state, { generatedAt: revision.committedAt });
    });
    return { revision: transaction.revision.revision, data: transaction.value };
  } catch (error) {
    if (error instanceof PostCommitError) {
      const cause = error.cause instanceof Error ? error.cause : new Error(String(error.cause));
      throw new RuntimeError("PROJECTION_FAILED", `semantic revision ${error.revision.revision} committed but projection failed: ${cause.message}`, { revision: error.revision.revision, committed: true, recovery: "run rebuild after correcting the projection filesystem" }, { cause });
    }
    throw error;
  }
}

function sourceByLocator(state: ProjectState, locator: string, kb?: string): SourceRecord | undefined {
  return Object.values(state.sources).find((source) => source.providerId === "file" && source.locator === locator && (kb === undefined || source.kb === kb || source.kb === "shared"));
}

function sourceNodeFor(state: ProjectState, sourceId: string): NodeRecord | undefined {
  const source = state.sources[sourceId];
  return source === undefined ? undefined : state.nodes[source.nodeId];
}

async function artifactDigest(root: string, locator: string): Promise<{ digest: string; bytesDigest: string }> {
  const provider = new FileKnowledgeProvider(root);
  const resolved = await provider.resolve(locator);
  const fetched = await provider.fetch(resolved);
  if (fetched.status !== "present" || fetched.digest === undefined || fetched.bytesDigest === undefined) {
    throw new ProviderError("PROVIDER_UNAVAILABLE", `artifact file is not available: ${locator}`);
  }
  return { digest: fetched.digest, bytesDigest: fetched.bytesDigest };
}

function sourceStateMatches(source: SourceRecord | undefined, fetched: { status: SourceAvailability; digest?: string; providerRevision?: string } | undefined): boolean {
  if (source === undefined || fetched === undefined || source.availability !== fetched.status) return false;
  return fetched.status !== "present" || (source.currentDigest === fetched.digest && source.providerRevision === fetched.providerRevision);
}

function providerFailureFetch(locator: string, error: unknown): ProviderFetch | undefined {
  if (!(error instanceof ProviderError) || error.code !== "PROVIDER_UNAVAILABLE") return undefined;
  let current: unknown = error;
  let denied = false;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { readonly code?: unknown }).code;
    if (code === "EACCES" || code === "EPERM") {
      denied = true;
      break;
    }
    current = (current as { readonly cause?: unknown }).cause;
  }
  return {
    status: denied ? "denied" : "unavailable",
    locator,
    diagnostics: error.message
  };
}

async function fetchKnownSource(
  provider: FileKnowledgeProvider,
  locator: string,
  knownSource: SourceRecord | undefined
): Promise<{ readonly resolved?: Awaited<ReturnType<FileKnowledgeProvider["resolve"]>>; readonly fetched: ProviderFetch }> {
  try {
    const resolved = await provider.resolve(locator);
    return { resolved, fetched: await provider.fetch(resolved) };
  } catch (error) {
    const failure = providerFailureFetch(locator, error);
    if (failure !== undefined && knownSource !== undefined && knownSource.locator === locator) return { fetched: failure };
    throw error;
  }
}

function evidenceNodeForObservation(state: ProjectState, observationId: string): NodeRecord | undefined {
  return Object.values(state.nodes).find((node) => node.kind === "evidence" && node.fields?.observationId === observationId);
}

function evidenceDescriptor(evidence: NodeRecord | undefined): (NodeRecord & { sourceId: string; observationId: string }) | null {
  if (evidence === undefined || typeof evidence.fields?.sourceId !== "string" || typeof evidence.fields.observationId !== "string") return null;
  return { ...evidence, sourceId: evidence.fields.sourceId, observationId: evidence.fields.observationId };
}

function visibleSource(state: ProjectState, source: SourceRecord, kb?: string): SourceRecord {
  if (kb !== undefined) {
    findKb(state, kb);
    if (source.kb !== "shared" && source.kb !== kb) {
      throw new RuntimeError("SCOPE_VIOLATION", `source ${source.id} is outside knowledge base ${kb}`, { sourceId: source.id, sourceKb: source.kb, kb });
    }
  }
  return source;
}

function sourceForId(state: ProjectState, sourceId: string, kb?: string): SourceRecord {
  const sources = state.sources as Record<string, SourceRecord>;
  if (!hasOwn(sources as Record<string, unknown>, sourceId)) throw new RuntimeError("NOT_FOUND", `source not found: ${sourceId}`, { sourceId });
  return visibleSource(state, sources[sourceId], kb);
}

function chronological<T extends { readonly createdAt: string; readonly id: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function sourceEvidence(state: ProjectState, source: SourceRecord, kb?: string): NodeRecord[] {
  return chronological(Object.values(state.nodes).filter((node) =>
    node.kind === "evidence" &&
    node.fields?.sourceId === source.id &&
    (kb === undefined || node.kb === "shared" || node.kb === kb)
  ));
}

function sourceObservations(state: ProjectState, source: SourceRecord): SourceObservation[] {
  return chronological(Object.values(state.observations).filter((observation) => observation.sourceId === source.id));
}

function sourceChanges(state: ProjectState, source: SourceRecord): ChangeRecord[] {
  return chronological(state.changes.filter((change) => change.sourceId === source.id));
}

function observationMatchesSource(source: SourceRecord | undefined, observation: SourceObservation | undefined): boolean {
  return source !== undefined && observation !== undefined &&
    source.availability === "present" && observation.availability === "present" &&
    source.currentDigest === observation.digest &&
    source.providerRevision === observation.providerRevision;
}

function dependentNodes(state: ProjectState, nodeId: string, kb?: string): NodeRecord[] {
  const candidates = new Map<string, NodeRecord>();
  for (const justification of Object.values(state.justifications)) {
    if (!justification.groups.some((group) => group.premises.includes(nodeId))) continue;
    const conclusion = hasOwn(state.nodes as Record<string, unknown>, justification.conclusion) ? state.nodes[justification.conclusion] : undefined;
    if (conclusion === undefined || conclusion.kb !== justification.kb) continue;
    if (kb !== undefined && conclusion.kb !== "shared" && conclusion.kb !== kb) continue;
    candidates.set(conclusion.id, conclusion);
  }
  for (const relationship of Object.values(state.relationships)) {
    if (relationship.to !== nodeId) continue;
    const from = hasOwn(state.nodes as Record<string, unknown>, relationship.from) ? state.nodes[relationship.from] : undefined;
    if (from === undefined || relationship.kb !== from.kb) continue;
    if (kb !== undefined && from.kb !== "shared" && from.kb !== kb) continue;
    candidates.set(from.id, from);
  }
  return [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function downstreamNodeIds(state: ProjectState, seeds: readonly string[], kb?: string): string[] {
  const result = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of dependentNodes(state, current, kb)) {
      if (result.has(dependent.id)) continue;
      result.add(dependent.id);
      queue.push(dependent.id);
    }
  }
  return [...result].sort((a, b) => a.localeCompare(b));
}

type SourceTransition = {
  readonly source: SourceRecord;
  readonly observation: SourceObservation;
  readonly evidence: (NodeRecord & { sourceId: string; observationId: string }) | null;
  readonly change?: ChangeRecord;
  readonly reviews: readonly ReviewRecord[];
  readonly changed: boolean;
};

function appendChangeReviews(
  draftState: MutableState,
  change: ChangeRecord,
  sourceId: string,
  actor: string,
  createdAt: string,
  kb?: string
): ReviewRecord[] {
  const source = hasOwn(draftState.sources as Record<string, unknown>, sourceId) ? draftState.sources[sourceId] : undefined;
  if (source === undefined) return [];
  const referencedEvidence = Object.values(draftState.nodes)
    .filter((node) => node.kind === "evidence" && node.fields?.sourceId === sourceId)
    .filter((evidence) => Object.values(draftState.justifications).some((justification) => justification.groups.some((group) => group.premises.includes(evidence.id))))
    .filter((evidence) => !observationMatchesSource(source, observationForEvidence(draftState, evidence)))
    .sort((a, b) => a.id.localeCompare(b.id));
  const nodeIds: string[] = [];
  for (const evidence of referencedEvidence) {
    nodeIds.push(evidence.id, ...downstreamNodeIds(draftState, [evidence.id], kb));
  }
  const reviews: ReviewRecord[] = [];
  for (const nodeId of [...new Set(nodeIds)]) {
    if (draftState.reviews.some((review) => review.nodeId === nodeId && review.triggerId === change.id)) continue;
    const review: ReviewRecord = {
      id: randomUUID(),
      nodeId,
      triggerType: "change",
      triggerId: change.id,
      reason: referencedEvidence.some((evidence) => evidence.id === nodeId) ? "source observation changed" : "support depends on changed evidence",
      status: "open",
      createdBy: actor,
      createdAt
    };
    draftState.reviews = [...draftState.reviews, review];
    reviews.push(review);
  }
  return reviews;
}

function applySourceTransition(
  draftState: ProjectState,
  sourceId: string,
  fetched: Awaited<ReturnType<FileKnowledgeProvider["fetch"]>>,
  context: { readonly kb: string; readonly actor: string; readonly createdAt: string; readonly locator: string; readonly title?: string; readonly reviewKb?: string }
): SourceTransition {
  const draft = mutableState(draftState);
  const sources = draft.sources;
  const observations = draft.observations;
  const nodes = draft.nodes;
  const freshExisting = hasOwn(sources as Record<string, unknown>, sourceId) ? sources[sourceId] : undefined;
  if (freshExisting !== undefined && sourceStateMatches(freshExisting, fetched)) {
    const observation = freshExisting.currentObservationId === undefined ? undefined : observations[freshExisting.currentObservationId];
    if (observation === undefined) throw new RuntimeError("INVALID_PROVENANCE", `source ${sourceId} has no current observation`);
    const evidence = evidenceNodeForObservation(draftState, observation.id);
    return { source: freshExisting, observation, evidence: evidenceDescriptor(evidence), reviews: [], changed: false };
  }

  const sourceNodeId = freshExisting?.nodeId ?? randomUUID();
  if (freshExisting === undefined) {
    const sourceNode: NodeRecord = {
      id: sourceNodeId,
      kb: context.kb,
      kind: "source",
      title: context.title?.trim() || `Source: ${context.locator}`,
      body: `Authoritative file source at ${context.locator}.`,
      fields: { sourceId, providerId: "file", locator: context.locator },
      createdBy: context.actor,
      createdAt: context.createdAt
    };
    nodes[sourceNodeId] = sourceNode;
  }

  const observationId = randomUUID();
  const observation: SourceObservation = {
    id: observationId,
    sourceId,
    providerId: "file",
    locator: context.locator,
    providerRevision: fetched.providerRevision,
    digest: fetched.digest,
    observedText: fetched.text,
    observedBytesDigest: fetched.bytesDigest,
    availability: fetched.status,
    diagnostics: fetched.diagnostics,
    contentType: fetched.contentType,
    createdBy: context.actor,
    createdAt: context.createdAt
  };
  observations[observationId] = observation;

  let evidence: NodeRecord | undefined;
  if (fetched.status === "present") {
    const evidenceId = randomUUID();
    evidence = {
      id: evidenceId,
      kb: freshExisting?.kb ?? context.kb,
      kind: "evidence",
      title: `Observation: ${context.locator}`,
      body: fetched.text ?? "",
      fields: {
        sourceId,
        observationId,
        providerId: "file",
        providerRevision: fetched.providerRevision,
        digest: fetched.digest,
        observedBytesDigest: fetched.bytesDigest,
        observedText: fetched.text,
        availability: fetched.status
      },
      createdBy: context.actor,
      createdAt: context.createdAt
    };
    nodes[evidenceId] = evidence;
  }

  const source: SourceRecord = {
    id: sourceId,
    nodeId: sourceNodeId,
    kb: freshExisting?.kb ?? context.kb,
    providerId: "file",
    locator: context.locator,
    selector: freshExisting?.selector,
    currentObservationId: observationId,
    availability: fetched.status,
    providerRevision: fetched.providerRevision,
    currentDigest: fetched.digest,
    lastCheckedAt: context.createdAt,
    createdBy: freshExisting?.createdBy ?? context.actor,
    createdAt: freshExisting?.createdAt ?? context.createdAt
  };
  sources[sourceId] = source;

  let change: ChangeRecord | undefined;
  let reviews: ReviewRecord[] = [];
  if (freshExisting !== undefined) {
    change = {
      id: randomUUID(),
      sourceId,
      beforeObservationId: freshExisting.currentObservationId,
      afterObservationId: observationId,
      beforeDigest: freshExisting.currentDigest,
      afterDigest: fetched.digest,
      beforeAvailability: freshExisting.availability,
      afterAvailability: fetched.status,
      reason: freshExisting.availability === "present" && fetched.status === "present" ? "content_changed" : "availability_changed",
      createdBy: context.actor,
      createdAt: context.createdAt
    };
    draft.changes = [...draft.changes, change];
    reviews = appendChangeReviews(draft, change, sourceId, context.actor, context.createdAt, context.reviewKb ?? (freshExisting.kb === "shared" ? undefined : freshExisting.kb));
  }

  return { source, observation, evidence: evidenceDescriptor(evidence), change, reviews, changed: true };
}

type SourceSelector = { readonly sourceId?: string; readonly locator?: string; readonly kb?: string };

async function selectedSource(root: string, state: ProjectState, request: SourceSelector): Promise<SourceRecord> {
  if (request.kb !== undefined) findKb(state, request.kb);
  if (request.sourceId !== undefined) {
    const source = sourceForId(state, request.sourceId, request.kb);
    if (request.locator !== undefined) {
      const resolved = await new FileKnowledgeProvider(root).resolve(request.locator);
      if (resolved.locator !== source.locator) {
        throw new RuntimeError("CONFLICT", `source identity ${source.id} is already bound to ${source.locator}`, { sourceId: source.id, locator: source.locator, requestedLocator: resolved.locator });
      }
    }
    return source;
  }
  if (request.locator === undefined) throw new RuntimeError("INVALID_REQUEST", "source selection requires sourceId or locator");
  const resolved = await new FileKnowledgeProvider(root).resolve(request.locator);
  const source = sourceByLocator(state, resolved.locator, request.kb);
  if (source === undefined) throw new RuntimeError("NOT_FOUND", `source not found for locator: ${resolved.locator}`, { locator: resolved.locator, kb: request.kb });
  return visibleSource(state, source, request.kb);
}

function visibleSources(state: ProjectState, kb?: string): SourceRecord[] {
  if (kb !== undefined) findKb(state, kb);
  return Object.values(state.sources)
    .filter((source) => kb === undefined || source.kb === "shared" || source.kb === kb)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function evidenceForSource(state: ProjectState, source: SourceRecord, kb?: string): Array<NodeRecord & { sourceId: string; observationId: string }> {
  return sourceEvidence(state, source, kb)
    .map((evidence) => evidenceDescriptor(evidence))
    .filter((evidence): evidence is NodeRecord & { sourceId: string; observationId: string } => evidence !== null);
}

function scopedChanges(state: ProjectState, kb?: string): ChangeRecord[] {
  const sourceIds = new Set(visibleSources(state, kb).map((source) => source.id));
  return chronological(state.changes.filter((change) => sourceIds.has(change.sourceId)));
}

function scopedReviews(state: ProjectState, kb?: string): ReviewRecord[] {
  if (kb !== undefined) findKb(state, kb);
  return chronological(state.reviews.filter((review) => {
    const node = hasOwn(state.nodes as Record<string, unknown>, review.nodeId) ? state.nodes[review.nodeId] : undefined;
    return node !== undefined && (kb === undefined || node.kb === "shared" || node.kb === kb);
  }));
}

function reviewsVisibleInKb(state: ProjectState, reviews: readonly ReviewRecord[], kb?: string): ReviewRecord[] {
  if (kb !== undefined) findKb(state, kb);
  return reviews.filter((review) => {
    const node = hasOwn(state.nodes as Record<string, unknown>, review.nodeId) ? state.nodes[review.nodeId] : undefined;
    return node !== undefined && (kb === undefined || node.kb === "shared" || node.kb === kb);
  });
}

function supportSourceIds(tree: SupportTree): string[] {
  const result = new Set<string>();
  const visit = (current: SupportTree): void => {
    if (current.node.kind === "source" && typeof current.node.fields?.sourceId === "string") result.add(current.node.fields.sourceId);
    if (current.node.kind === "evidence" && typeof current.node.fields?.sourceId === "string") result.add(current.node.fields.sourceId);
    for (const justification of current.justifications) {
      for (const group of justification.groups) {
        for (const premise of group.premises) if (premise.tree !== undefined) visit(premise.tree);
      }
    }
  };
  visit(tree);
  return [...result].sort((a, b) => a.localeCompare(b));
}

function supportEvidenceAndObservations(state: ProjectState, sourceIds: readonly string[], kb?: string): { evidence: Array<NodeRecord & { sourceId: string; observationId: string }>; observations: SourceObservation[] } {
  const evidence = new Map<string, NodeRecord & { sourceId: string; observationId: string }>();
  const observations = new Map<string, SourceObservation>();
  for (const sourceId of sourceIds) {
    const source = hasOwn(state.sources as Record<string, unknown>, sourceId) ? state.sources[sourceId] : undefined;
    if (source === undefined || (kb !== undefined && source.kb !== "shared" && source.kb !== kb)) continue;
    for (const entry of evidenceForSource(state, source, kb)) evidence.set(entry.id, entry);
    for (const observation of sourceObservations(state, source)) observations.set(observation.id, observation);
  }
  return {
    evidence: chronological([...evidence.values()]),
    observations: chronological([...observations.values()])
  };
}

function sourceForNode(state: ProjectState, node: NodeRecord): SourceRecord | undefined {
  const sourceId = node.fields?.sourceId;
  if (typeof sourceId === "string" && hasOwn(state.sources as Record<string, unknown>, sourceId)) return state.sources[sourceId];
  if (node.kind === "source") return Object.values(state.sources).find((source) => source.nodeId === node.id);
  return undefined;
}

type ImpactEntry = { readonly node: NodeRecord; readonly paths: readonly string[][]; readonly reasons: readonly string[] };

function impactReason(state: ProjectState, fromId: string, to: NodeRecord): string {
  const from = hasOwn(state.nodes as Record<string, unknown>, fromId) ? state.nodes[fromId] : undefined;
  if (from?.kind === "evidence") return "support depends on changed evidence";
  if (to.kind === "decision" || to.kind === "artifact") return `basis depends on changed ${from?.kind ?? "knowledge"}`;
  return `support depends on changed ${from?.kind ?? "knowledge"}`;
}

function impactEntries(state: ProjectState, node: NodeRecord, kb?: string): ImpactEntry[] {
  const paths = new Map<string, string[][]>();
  const reasons = new Map<string, Set<string>>();
  const queue: Array<{ readonly id: string; readonly path: string[] }> = [];
  const source = sourceForNode(state, node);
  if (node.kind === "source" && source !== undefined) {
    for (const evidence of sourceEvidence(state, source, kb)) {
      const reason = evidence.fields?.observationId === source.currentObservationId ? "source observation retained" : "source observation changed";
      paths.set(evidence.id, [[node.id, evidence.id]]);
      reasons.set(evidence.id, new Set([reason]));
      queue.push({ id: evidence.id, path: [node.id, evidence.id] });
    }
  } else {
    queue.push({ id: node.id, path: [node.id] });
  }
  while (queue.length > 0) {
    const current = queue.shift() as { readonly id: string; readonly path: string[] };
    for (const dependent of dependentNodes(state, current.id, kb)) {
      if (current.path.includes(dependent.id)) continue;
      const path = [...current.path, dependent.id];
      const existingPaths = paths.get(dependent.id) ?? [];
      if (!existingPaths.some((candidate) => candidate.length === path.length && candidate.every((id, index) => id === path[index]))) existingPaths.push(path);
      paths.set(dependent.id, existingPaths);
      const existingReasons = reasons.get(dependent.id) ?? new Set<string>();
      existingReasons.add(impactReason(state, current.id, dependent));
      reasons.set(dependent.id, existingReasons);
      queue.push({ id: dependent.id, path });
    }
  }
  return [...paths.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, nodePaths]) => ({
      node: state.nodes[id] as NodeRecord,
      paths: nodePaths,
      reasons: [...(reasons.get(id) ?? new Set<string>())].sort((a, b) => a.localeCompare(b))
    }));
}

function impactSourceIds(state: ProjectState, node: NodeRecord, affected: readonly ImpactEntry[]): string[] {
  const sourceIds = new Set<string>();
  const direct = sourceForNode(state, node);
  if (direct !== undefined) sourceIds.add(direct.id);
  for (const entry of affected) {
    const source = sourceForNode(state, entry.node);
    if (source !== undefined) sourceIds.add(source.id);
  }
  for (const entry of [node, ...affected.map((item) => item.node)]) {
    try {
      for (const sourceId of supportSourceIds(buildSupportTree(state, entry.id))) sourceIds.add(sourceId);
    } catch {
      // The durable reader already validates references; keep the query safe
      // if a future provider supplies a partially indexed node.
    }
  }
  return [...sourceIds].sort((a, b) => a.localeCompare(b));
}

async function handleCaptureSource(root: string, request: Extract<RuntimeRequest, { op: "capture_source" }>): Promise<RuntimeResponse> {
  const actor = requireActor(request);
  const loaded = await readHistory(root);
  const state = loaded.revision.state;
  const kb = request.kb ?? "shared";
  findKb(state, kb);
  const provider = new FileKnowledgeProvider(root);
  const requestedSourceId = request.sourceId === undefined ? undefined : requireUuid(request.sourceId, "sourceId");
  const sourceById = requestedSourceId === undefined || !hasOwn(state.sources as Record<string, unknown>, requestedSourceId)
    ? undefined
    : state.sources[requestedSourceId];
  const sourceByRequestedLocator = sourceByLocator(state, request.locator, kb);
  const fetchedSource = await fetchKnownSource(provider, request.locator, sourceById ?? sourceByRequestedLocator);
  const resolved = fetchedSource.resolved;
  if (sourceById !== undefined) {
    const requestedLocator = resolved?.locator ?? request.locator;
    if (sourceById.providerId !== provider.id || sourceById.locator !== requestedLocator) {
      throw new RuntimeError("CONFLICT", `source identity ${requestedSourceId} is already bound to ${sourceById.locator}`, { sourceId: requestedSourceId, locator: sourceById.locator, requestedLocator });
    }
    if (sourceById.kb !== "shared" && sourceById.kb !== kb) {
      throw new RuntimeError("SCOPE_VIOLATION", `source ${requestedSourceId} belongs to knowledge base ${sourceById.kb}`, { sourceId: requestedSourceId, sourceKb: sourceById.kb, requestedKb: kb });
    }
  }
  const normalizedLocator = resolved?.locator ?? request.locator;
  const existing = sourceByLocator(state, normalizedLocator, kb);
  if (requestedSourceId !== undefined && existing !== undefined && existing.id !== requestedSourceId) {
    throw new RuntimeError("CONFLICT", `source locator is already associated with ${existing.id}`, { locator: normalizedLocator, sourceId: existing.id });
  }
  const fetched = fetchedSource.fetched;
  const sourceId = existing?.id ?? requestedSourceId ?? randomUUID();
  if (existing && sourceStateMatches(existing, fetched)) {
    if (request.expectedRevision !== undefined && request.expectedRevision !== loaded.revision.revision) {
      throw new RuntimeError("CONFLICT", `expected revision ${request.expectedRevision} but current revision is ${loaded.revision.revision}`, { expectedRevision: request.expectedRevision, currentRevision: loaded.revision.revision });
    }
    const observation = existing.currentObservationId === undefined ? undefined : state.observations[existing.currentObservationId];
    const evidence = observation === undefined ? undefined : evidenceNodeForObservation(state, observation.id);
    return {
      revision: loaded.revision.revision,
      data: { source: existing, observation, evidence: evidenceDescriptor(evidence), changed: false, committed: false }
    };
  }
  const baseline = request.expectedRevision ?? loaded.revision.revision;
  const createdAt = atTime(request.at);
  type CaptureValue = { source: SourceRecord; observation: SourceObservation; evidence: (NodeRecord & { sourceId: string; observationId: string }) | null; changed: boolean; committed: boolean; change?: ChangeRecord; reviews: readonly ReviewRecord[] };
  const result = await commitMutation<CaptureValue>(root, actor, "capture_source", baseline, (draftState) => {
    const transition = applySourceTransition(draftState, sourceId, fetched, {
      kb,
      actor,
      createdAt,
      locator: normalizedLocator,
      title: request.title
    });
    return {
      state: draftState,
      value: {
        source: transition.source,
        observation: transition.observation,
        evidence: transition.evidence,
        changed: transition.changed,
        committed: true,
        change: transition.change,
        reviews: transition.reviews
      }
    };
  });
  return {
    revision: result.revision,
    data: {
      ...result.data,
      reviews: reviewsVisibleInKb(state, result.data.reviews, request.kb ?? "shared")
    }
  };
}

async function handleInspectSource(root: string, request: Extract<RuntimeRequest, { op: "inspect_source" }>): Promise<RuntimeResponse> {
  const loaded = await readHistory(root);
  const state = loaded.revision.state;
  const source = await selectedSource(root, state, request);
  const observations = sourceObservations(state, source);
  const evidence = evidenceForSource(state, source, request.kb);
  const changes = sourceChanges(state, source);
  return {
    revision: loaded.revision.revision,
    data: {
      source,
      observations,
      evidence,
      changes,
      scope: request.kb === undefined ? undefined : { kb: request.kb }
    }
  };
}

async function handleEvidence(root: string, request: Extract<RuntimeRequest, { op: "evidence" }>): Promise<RuntimeResponse> {
  const loaded = await readHistory(root);
  const state = loaded.revision.state;
  let source: SourceRecord;
  if (request.evidenceId !== undefined) {
    const node = nodeById(state, request.evidenceId);
    if (node.kind !== "evidence" || typeof node.fields?.sourceId !== "string") {
      throw new RuntimeError("INVALID_PROVENANCE", `node ${request.evidenceId} is not retained evidence`, { evidenceId: request.evidenceId });
    }
    visibleNode(state, node.id, request.kb);
    source = sourceForId(state, node.fields.sourceId, request.kb);
    if (request.sourceId !== undefined && request.sourceId !== source.id) {
      throw new RuntimeError("CONFLICT", `evidence ${node.id} belongs to source ${source.id}`, { evidenceId: node.id, sourceId: source.id, requestedSourceId: request.sourceId });
    }
  } else {
    if (request.sourceId === undefined) throw new RuntimeError("INVALID_REQUEST", "evidence selection requires evidenceId or sourceId");
    source = sourceForId(state, request.sourceId, request.kb);
  }
  return {
    revision: loaded.revision.revision,
    data: {
      source,
      observations: sourceObservations(state, source),
      evidence: evidenceForSource(state, source, request.kb),
      changes: sourceChanges(state, source),
      scope: request.kb === undefined ? undefined : { kb: request.kb }
    }
  };
}

async function handleChanged(root: string, request: Extract<RuntimeRequest, { op: "changed" }>): Promise<RuntimeResponse> {
  const loaded = await readHistory(root);
  const state = loaded.revision.state;
  const sources = request.sourceId === undefined ? visibleSources(state, request.kb) : [sourceForId(state, request.sourceId, request.kb)];
  const sourceIds = new Set(sources.map((source) => source.id));
  const observations = chronological(Object.values(state.observations).filter((observation) => sourceIds.has(observation.sourceId)));
  const changes = chronological(state.changes.filter((change) => sourceIds.has(change.sourceId)));
  return {
    revision: loaded.revision.revision,
    data: {
      sources,
      observations,
      changes,
      scope: request.kb === undefined ? undefined : { kb: request.kb }
    }
  };
}

async function handleRefresh(root: string, request: Extract<RuntimeRequest, { op: "refresh" }>): Promise<RuntimeResponse> {
  const actor = requireActor(request);
  const loaded = await readHistory(root);
  if (request.expectedRevision !== undefined && request.expectedRevision !== loaded.revision.revision) {
    throw new RuntimeError("CONFLICT", `expected revision ${request.expectedRevision} but current revision is ${loaded.revision.revision}`, { expectedRevision: request.expectedRevision, currentRevision: loaded.revision.revision });
  }
  const state = loaded.revision.state;
  const selected = request.sourceIds === undefined
    ? visibleSources(state, request.kb)
    : [...new Set(request.sourceIds)].sort((a, b) => a.localeCompare(b)).map((sourceId) => sourceForId(state, sourceId, request.kb));
  const provider = new FileKnowledgeProvider(root);
  const fetched = new Map<string, Awaited<ReturnType<FileKnowledgeProvider["fetch"]>>>();
  for (const source of selected) {
    try {
      const resolved = await provider.resolve(source.locator);
      if (resolved.locator !== source.locator) {
        throw new RuntimeError("CONFLICT", `source identity ${source.id} is bound to a noncanonical locator`, { sourceId: source.id, locator: source.locator, resolvedLocator: resolved.locator });
      }
      fetched.set(source.id, await provider.fetch(resolved));
    } catch (error) {
      const failure = providerFailureFetch(source.locator, error);
      if (failure === undefined) throw error;
      fetched.set(source.id, failure);
    }
  }
  const unchanged = selected.every((source) => sourceStateMatches(source, fetched.get(source.id)));
  if (unchanged) {
    return {
      revision: loaded.revision.revision,
      data: { changed: false, sources: selected, observations: [], changes: [], reviews: [], committed: false, scope: request.kb === undefined ? undefined : { kb: request.kb } }
    };
  }
  const createdAt = atTime(request.at);
  const baseline = request.expectedRevision ?? loaded.revision.revision;
  type RefreshValue = { readonly changed: boolean; readonly sources: SourceRecord[]; readonly observations: SourceObservation[]; readonly changes: ChangeRecord[]; readonly reviews: ReviewRecord[]; readonly committed: boolean };
  const result = await commitMutation<RefreshValue>(root, actor, "refresh", baseline, (draftState) => {
    const transitions: SourceTransition[] = [];
    for (const source of selected) {
      const result = applySourceTransition(draftState, source.id, fetched.get(source.id) as Awaited<ReturnType<FileKnowledgeProvider["fetch"]>>, {
        kb: source.kb,
        actor,
        createdAt,
        locator: source.locator
      });
      if (result.changed) transitions.push(result);
    }
    const changedSources = selected.map((source) => {
      const current = hasOwn(draftState.sources as Record<string, unknown>, source.id) ? draftState.sources[source.id] : undefined;
      return current ?? source;
    });
    return {
      state: draftState,
      value: {
        changed: transitions.length > 0,
        sources: changedSources,
        observations: transitions.map((transition) => transition.observation),
        changes: transitions.flatMap((transition) => transition.change === undefined ? [] : [transition.change]),
        reviews: transitions.flatMap((transition) => [...transition.reviews]),
        committed: transitions.length > 0
      }
    };
  });
  return {
    revision: result.revision,
    data: {
      ...result.data,
      reviews: reviewsVisibleInKb(state, result.data.reviews, request.kb)
    }
  };
}

async function handleImpact(root: string, request: Extract<RuntimeRequest, { op: "impact" }>): Promise<RuntimeResponse> {
  const loaded = await readHistory(root);
  const state = loaded.revision.state;
  const node = visibleNode(state, request.nodeId, request.kb);
  const affected = impactEntries(state, node, request.kb);
  const sourceIds = new Set(impactSourceIds(state, node, affected));
  const changes = chronological(state.changes.filter((change) => sourceIds.has(change.sourceId)));
  const changeIds = new Set(changes.map((change) => change.id));
  const affectedIds = new Set(affected.map((entry) => entry.node.id));
  const reviews = chronological(state.reviews.filter((review) => affectedIds.has(review.nodeId) && (changeIds.size === 0 || changeIds.has(review.triggerId))));
  return {
    revision: loaded.revision.revision,
    data: {
      node,
      affected,
      changes,
      reviews,
      scope: request.kb === undefined ? undefined : { kb: request.kb }
    }
  };
}

async function handleReview(root: string, request: Extract<RuntimeRequest, { op: "review" }>): Promise<RuntimeResponse> {
  const loaded = await readHistory(root);
  if (request.reviewId !== undefined || request.actor !== undefined || request.rationale !== undefined) {
    throw new RuntimeError("INVALID_REQUEST", "review mutations are not available in the source maintenance slice");
  }
  const reviews = scopedReviews(loaded.revision.state, request.kb).filter((review) => request.status === undefined || review.status === request.status);
  return {
    revision: loaded.revision.revision,
    data: {
      reviews,
      changes: scopedChanges(loaded.revision.state, request.kb),
      scope: request.kb === undefined ? undefined : { kb: request.kb }
    }
  };
}

function validatedApplicability(value: unknown): Applicability | undefined {
  try {
    return validateApplicability(value);
  } catch (error) {
    throw new RuntimeError("INVALID_REQUEST", error instanceof Error ? error.message : String(error));
  }
}

async function handleRecord(root: string, request: Extract<RuntimeRequest, { op: "record" }>): Promise<RuntimeResponse> {
  const actor = requireActor(request);
  const loaded = await readHistory(root);
  const state = loaded.revision.state;
  findKb(state, request.kb);
  if (!NODE_KINDS.includes(request.kind)) throw new RuntimeError("INVALID_NODE", `unsupported node kind: ${String(request.kind)}`);
  if (request.kind === "source" || request.kind === "evidence") throw new RuntimeError("INVALID_PROVENANCE", `${request.kind} nodes are created only by capture_source`);
  const nodeId = request.id === undefined ? randomUUID() : requireUuid(request.id, "id");
  if (hasOwn(state.nodes as Record<string, unknown>, nodeId)) throw new RuntimeError("CONFLICT", `node already exists: ${nodeId}`, { id: nodeId });
  if (typeof request.title !== "string" || request.title.trim().length === 0) throw new RuntimeError("INVALID_NODE", "node title must be nonempty");
  if (request.body !== undefined && typeof request.body !== "string") throw new RuntimeError("INVALID_NODE", "node body must be a string");
  if (request.fields !== undefined && (typeof request.fields !== "object" || request.fields === null || Array.isArray(request.fields))) throw new RuntimeError("INVALID_NODE", "node fields must be an object");
  const applicability = validatedApplicability(request.applicability);
  const fields = cloneFields(request.fields);
  const basis = request.kind === "decision" || request.kind === "artifact" ? basisGroups(request) : undefined;
  if (basis) {
    for (const group of basis) for (const premise of group.premises) visibleNode(state, premise, request.kb);
    fields.basis = basis.flatMap((group) => group.premises);
    fields.basisGroups = basis.map((group) => [...group.premises]);
  }
  const considered = fields.consideredOptions;
  if (considered !== undefined) {
    if (!Array.isArray(considered) || considered.some((id) => typeof id !== "string")) throw new RuntimeError("INVALID_NODE", "consideredOptions must be node IDs");
    for (const id of considered) visibleNode(state, id, request.kb);
  }
  if (fields.selectedOption !== undefined) {
    if (typeof fields.selectedOption !== "string" || considered === undefined || !considered.includes(fields.selectedOption)) throw new RuntimeError("INVALID_NODE", "selectedOption must be one of consideredOptions");
    visibleNode(state, fields.selectedOption, request.kb);
  }
  let artifactFile: { digest: string; bytesDigest: string } | undefined;
  const locator = fields.locator;
  if (request.kind === "artifact" && locator !== undefined) {
    if (typeof locator !== "string" || locator.trim().length === 0) throw new RuntimeError("INVALID_NODE", "artifact locator must be a nonempty project-relative path");
    artifactFile = await artifactDigest(root, locator);
    if (fields.digest !== undefined && fields.digest !== artifactFile.digest) throw new RuntimeError("INVALID_NODE", "artifact digest does not match its file");
    fields.digest = artifactFile.digest;
    fields.observedBytesDigest = artifactFile.bytesDigest;
  }
  const links = request.links ?? [];
  for (const link of links) {
    if (!RELATIONSHIP_TYPES.includes(link.type)) throw new RuntimeError("INVALID_RELATIONSHIP", `unsupported relationship type: ${String(link.type)}`);
    visibleNode(state, link.to, request.kb);
  }
  const baseline = request.expectedRevision ?? loaded.revision.revision;
  const createdAt = atTime(request.at);
  return commitMutation(root, actor, "record", baseline, (draftState, nextRevision) => {
    const draft = mutableState(draftState);
    if (hasOwn(draft.nodes as Record<string, unknown>, nodeId)) throw new RuntimeError("CONFLICT", `node already exists: ${nodeId}`);
    const originalBasisJustificationId = basis === undefined ? undefined : randomUUID();
    if (originalBasisJustificationId !== undefined) fields.originalBasisJustificationId = originalBasisJustificationId;
    if (originalBasisJustificationId !== undefined) fields.recordedAtRevision = nextRevision;
    const node: NodeRecord = {
      id: nodeId,
      kb: request.kb,
      kind: request.kind,
      title: request.title.trim(),
      body: request.body ?? "",
      applicability,
      fields,
      createdBy: actor,
      createdAt
    };
    draft.nodes[nodeId] = node;
    let originalJustification: JustificationRecord | undefined;
    if (basis !== undefined && originalBasisJustificationId !== undefined) {
      originalJustification = {
        id: originalBasisJustificationId,
        kb: request.kb,
        conclusion: nodeId,
        groups: basis,
        rationale: typeof fields.rationale === "string" && fields.rationale.trim().length > 0 ? fields.rationale.trim() : `Original basis recorded with ${request.kind}`,
        title: `Original basis for ${node.title}`,
        createdBy: actor,
        createdAt
      };
      draft.justifications[originalJustification.id] = originalJustification;
    }
    const relationships: RelationshipRecord[] = [];
    for (const link of links) {
      const relationship: RelationshipRecord = { id: randomUUID(), kb: request.kb, from: nodeId, to: link.to, type: link.type, rationale: link.rationale, createdBy: actor, createdAt };
      draft.relationships[relationship.id] = relationship;
      relationships.push(relationship);
    }
    return { state: draftState, value: { node, justification: originalJustification ?? null, relationships, artifactFile, recordedAtRevision: nextRevision } };
  });
}

async function handleJustify(root: string, request: Extract<RuntimeRequest, { op: "justify" }>): Promise<RuntimeResponse> {
  const actor = requireActor(request);
  const loaded = await readHistory(root);
  const state = loaded.revision.state;
  const conclusion = visibleNode(state, request.conclusion, request.kb);
  const kb = request.kb ?? conclusion.kb;
  findKb(state, kb);
  if (kb !== conclusion.kb) {
    throw new RuntimeError("SCOPE_VIOLATION", `justification ownership ${kb} does not match conclusion knowledge base ${conclusion.kb}`, { conclusion: conclusion.id, conclusionKb: conclusion.kb, justificationKb: kb });
  }
  const groups = normalizeGroups(request.groups);
  for (const group of groups) {
    for (const premise of group.premises) {
      const premiseNode = visibleNode(state, premise, kb);
      if (conclusion.kb === "shared" && premiseNode.kb !== "shared") {
        throw new RuntimeError("SCOPE_VIOLATION", "a shared conclusion cannot depend on a child-scoped premise", { conclusion: conclusion.id, premise: premiseNode.id, premiseKb: premiseNode.kb });
      }
    }
  }
  ensureNoSupportCycle(state, conclusion.id, groups);
  const rationale = assertRationale(request.rationale);
  const applicability = validatedApplicability(request.applicability);
  const baseline = request.expectedRevision ?? loaded.revision.revision;
  const createdAt = atTime(request.at);
  return commitMutation(root, actor, "justify", baseline, (draftState) => {
    const draft = mutableState(draftState);
    if (!hasOwn(draft.nodes as Record<string, unknown>, conclusion.id)) throw new RuntimeError("NOT_FOUND", `node not found: ${conclusion.id}`);
    const j: JustificationRecord = {
      id: randomUUID(),
      kb,
      conclusion: conclusion.id,
      groups,
      rationale,
      title: request.title?.trim() || undefined,
      applicability,
      createdBy: actor,
      createdAt
    };
    draft.justifications[j.id] = j;
    return { state: draftState, value: { justification: j, committed: true } };
  });
}

type Assessment = {
  readonly status: "usable" | "pending" | "unusable";
  readonly reason: string;
};

function assessApplicability(applicability: Applicability | undefined, evaluationTime: string): Assessment {
  if (applicability === undefined) return { status: "usable", reason: "no applicability bounds declared" };
  const time = Date.parse(evaluationTime);
  if (applicability.validFrom !== undefined && Date.parse(applicability.validFrom) > time) return { status: "pending", reason: "applicability starts after evaluation time" };
  if (applicability.validUntil !== undefined && Date.parse(applicability.validUntil) <= time) return { status: "pending", reason: "applicability expired at evaluation time" };
  if (applicability.subject !== undefined || applicability.version !== undefined) return { status: "pending", reason: "subject/version applicability needs an explicit evaluation context" };
  return { status: "usable", reason: "applicability matches evaluation time" };
}

function assessNode(state: ProjectState, nodeId: string, evaluationTime: string, stack = new Set<string>()): Assessment {
  const node = nodeById(state, nodeId);
  const applicability = assessApplicability(node.applicability, evaluationTime);
  if (applicability.status !== "usable") return applicability;
  if (stack.has(nodeId)) return { status: "pending", reason: "support cycle encountered" };
  if (node.kind === "assumption" || node.kind === "requirement") {
    return node.fields?.accepted === true ? { status: "usable", reason: "explicitly accepted assumption/requirement" } : { status: "pending", reason: "assumption/requirement is not explicitly accepted" };
  }
  if (node.kind === "evidence") {
    const source = currentSourceForNode(state, node);
    const observation = observationForEvidence(state, node);
    if (observationMatchesSource(source, observation)) return { status: "usable", reason: "retained evidence matches the current source digest and provider revision" };
    return { status: "pending", reason: "retained evidence is historical or its source is unavailable" };
  }
  const justifications = Object.values(state.justifications).filter((j) => j.conclusion === nodeId && j.kb === node.kb);
  if (justifications.length === 0) return { status: "pending", reason: "no declared support basis" };
  const nextStack = new Set(stack);
  nextStack.add(nodeId);
  let pending = false;
  for (const justification of justifications) {
    const justificationApplicability = assessApplicability(justification.applicability, evaluationTime);
    if (justificationApplicability.status !== "usable") {
      pending = true;
      continue;
    }
    for (const group of justification.groups) {
      const assessments = group.premises.map((premise) => assessNode(state, premise, evaluationTime, nextStack));
      if (assessments.every((item) => item.status === "usable")) return { status: "usable", reason: `declared basis ${justification.id} is usable` };
      if (assessments.some((item) => item.status === "pending")) pending = true;
    }
  }
  return pending ? { status: "pending", reason: "all declared support groups need review" } : { status: "unusable", reason: "no declared support group is usable" };
}

function provenanceFor(tree: SupportTree): Array<{ sourceId: string; observationId: string; observedText: string; providerRevision: string }> {
  return supportProvenance(tree)
    .filter(({ observation }) => observation.observedText !== undefined && observation.providerRevision !== undefined)
    .map(({ source, observation }) => ({
      sourceId: source.id,
      observationId: observation.id,
      observedText: observation.observedText as string,
      providerRevision: observation.providerRevision as string
    }));
}

async function handleWhy(root: string, request: Extract<RuntimeRequest, { op: "why" }>): Promise<RuntimeResponse> {
  const revision = (await readHistory(root, request.revision)).revision;
  const state = revision.state;
  const node = visibleNode(state, request.nodeId, request.kb);
  const evaluationTime = atTime(request.evaluationTime ?? revision.committedAt);
  const justifications = Object.values(state.justifications)
    .filter((j) => j.conclusion === node.id && j.kb === node.kb)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const originalId = node.fields?.originalBasisJustificationId;
  const originalJustification = typeof originalId === "string" && hasOwn(state.justifications as Record<string, unknown>, originalId) ? state.justifications[originalId] : undefined;
  const supportTree = buildSupportTree(state, node.id);
  const upstreamIds = supportNodeIds(supportTree);
  const support = assessNode(state, node.id, evaluationTime);
  const retained = supportEvidenceAndObservations(state, supportSourceIds(supportTree), request.kb);
  const changes = scopedChanges(state, request.kb);
  const reviews = scopedReviews(state, request.kb);
  const currentSupport = justifications.map((justification) => {
    const assessment = assessApplicability(justification.applicability, evaluationTime);
    return {
      justification,
      groups: justification.groups.map((group) => ({
        ...group,
        status: assessment.status === "usable" && group.premises.every((premise) => assessNode(state, premise, evaluationTime).status === "usable") ? "usable" : "pending"
      })),
      assessment
    };
  });
  return {
    revision: revision.revision,
    data: {
      node,
      evaluationTime,
      support,
      originalBasis: originalJustification === undefined ? null : { justification: originalJustification, recordedAtRevision: node.fields?.recordedAtRevision ?? null },
      currentSupport,
      currentAlternatives: currentSupport.filter((item) => item.justification.id !== originalJustification?.id),
      justifications: currentSupport,
      upstream: upstreamIds.map((id) => state.nodes[id]).filter((item): item is NodeRecord => item !== undefined),
      provenance: provenanceFor(supportTree),
      reviews,
      changes,
      evidence: retained.evidence,
      observations: retained.observations,
      scope: request.kb === undefined ? undefined : { kb: request.kb }
    }
  };
}

/** Public dispatcher. Additional operations are added in bounded TDD slices. */
export async function executeOperation(rootInput: string, request: RuntimeRequest): Promise<RuntimeResponse> {
  const root = await canonicalRoot(rootInput);
  if (!request || typeof request !== "object" || typeof request.op !== "string") {
    throw new RuntimeError("INVALID_REQUEST", "request must contain an operation discriminant");
  }
  validateRuntimeRequest(request);
  const loaded = await ensureHistory(root);
  const current = loaded.revision;
  if (request.op === "knowledge_bases") {
    const requestedKb = request.kb;
    if (requestedKb !== undefined) findKb(current.state, requestedKb);
    const knowledgeBases = Object.values(current.state.kbs)
      .filter((kb) => requestedKb === undefined || kb.id === requestedKb || kb.id === "shared")
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((kb) => kbDescriptor(root, kb, requestedKb !== undefined && kb.id === "shared" && requestedKb !== "shared"));
    return {
      revision: current.revision,
      data: {
        project: { id: current.state.projectId, name: current.state.projectName },
        scope: requestedKb === undefined ? { kb: null, inherited: false } : { kb: requestedKb },
        knowledgeBases,
        kbs: knowledgeBases
      }
    };
  }
  if (request.op === "create_kb") {
    const actor = requireActor(request);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(request.id) || request.id === "shared") {
      throw new RuntimeError("INVALID_SCOPE", "knowledge base id must be a non-shared identifier using letters, numbers, dot, underscore or hyphen");
    }
    if (typeof request.title !== "string" || request.title.trim().length === 0) throw new RuntimeError("INVALID_REQUEST", "knowledge base title must be nonempty");
    if (hasOwn(current.state.kbs as Record<string, unknown>, request.id)) throw new RuntimeError("CONFLICT", `knowledge base already exists: ${request.id}`, { id: request.id });
    const parent = request.parent ?? "shared";
    findKb(current.state, parent);
    if (parent !== "shared") throw new RuntimeError("INVALID_SCOPE", "child knowledge bases must inherit directly from shared");
    if (request.expectedRevision !== undefined && request.expectedRevision !== current.revision) {
      throw new RuntimeError("CONFLICT", `expected revision ${request.expectedRevision} but current revision is ${current.revision}`, { expectedRevision: request.expectedRevision, currentRevision: current.revision });
    }
    await ensureChildDirectory(root, request.id);
    const createdAt = atTime(request.at);
    const result = await transact(root, actor, "create_kb", (state, nextRevision) => {
      if (request.expectedRevision !== undefined && request.expectedRevision !== nextRevision - 1) {
        throw new RuntimeError("CONFLICT", `expected revision ${request.expectedRevision} but current revision is ${nextRevision - 1}`);
      }
      if (hasOwn(state.kbs as Record<string, unknown>, request.id)) throw new RuntimeError("CONFLICT", `knowledge base already exists: ${request.id}`);
      const knowledgeBase: KnowledgeBaseRecord = { id: request.id, title: request.title.trim(), parent, createdBy: actor, createdAt };
      const nextState = { ...state, kbs: { ...state.kbs, [request.id]: knowledgeBase } } as ProjectState;
      return { state: nextState, value: kbDescriptor(root, knowledgeBase, false) };
    });
    return { revision: result.revision.revision, data: { knowledgeBase: result.value, committed: true } };
  }
  if (request.op === "capture_source") return handleCaptureSource(root, request);
  if (request.op === "inspect_source") return handleInspectSource(root, request);
  if (request.op === "evidence") return handleEvidence(root, request);
  if (request.op === "refresh") return handleRefresh(root, request);
  if (request.op === "changed") return handleChanged(root, request);
  if (request.op === "record") return handleRecord(root, request);
  if (request.op === "justify") return handleJustify(root, request);
  if (request.op === "why") return handleWhy(root, request);
  if (request.op === "impact") return handleImpact(root, request);
  if (request.op === "review") return handleReview(root, request);
  if (request.op === "rebuild") return handleRebuild(root, request);
  if (request.op === "export") {
    if (request.kb !== undefined) findKb(current.state, request.kb);
    if (request.outputDir !== undefined && request.outputDir !== root) {
      throw new RuntimeError("INVALID_REQUEST", "export outputDir is not supported in the initial projection slice; export to the project root");
    }
    try {
      const projection = await writeProjection(root, current.state, { kb: request.kb, repair: request.repair === true, generatedAt: current.committedAt });
      return {
        revision: current.revision,
        data: {
          directory: root,
          files: projection.files,
          manifestDigest: projection.manifestDigest,
          historyIncluded: false,
          profile: "okf-0.2+justification-1"
        }
      };
    } catch (error) {
      if (error instanceof ProjectionError) throw new RuntimeError("PROJECTION_DRIFT", error.message, undefined, { cause: error });
      throw error;
    }
  }
  throw new RuntimeError("INVALID_REQUEST", `unsupported runtime operation: ${request.op}`);
}

export { NODE_KINDS, RELATIONSHIP_TYPES };
