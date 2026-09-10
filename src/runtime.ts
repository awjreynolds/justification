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
import { ensureHistory, readHistory, transact } from "./storage.ts";
import { FileKnowledgeProvider, ProviderError } from "./provider.ts";
import { ProjectionError, writeProjection } from "./serializer.ts";

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
  if (kb !== undefined && node.kb !== "shared" && node.kb !== kb) {
    throw new RuntimeError("SCOPE_VIOLATION", `node ${id} is outside knowledge base ${kb}`, { id, kb });
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
  const transaction = await transact(root, actor, action, (state, nextRevision) => {
    if (expectedRevision !== undefined && expectedRevision !== nextRevision - 1) throw new RuntimeError("CONFLICT", `expected revision ${expectedRevision} but current revision is ${nextRevision - 1}`, { expectedRevision, currentRevision: nextRevision - 1 });
    return mutate(state, nextRevision);
  });
  try {
    await writeProjection(root, transaction.revision.state, { generatedAt: transaction.revision.committedAt });
  } catch (error) {
    if (error instanceof ProjectionError) throw new RuntimeError("PROJECTION_DRIFT", `semantic revision ${transaction.revision.revision} committed but projection failed: ${error.message}`, { revision: transaction.revision.revision }, { cause: error });
    throw error;
  }
  return { revision: transaction.revision.revision, data: transaction.value };
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

function sourceStateMatches(source: SourceRecord | undefined, fetched: { status: SourceAvailability; digest?: string }): boolean {
  if (source === undefined || source.availability !== fetched.status) return false;
  return fetched.status !== "present" || source.currentDigest === fetched.digest;
}

function evidenceNodeForObservation(state: ProjectState, observationId: string): NodeRecord | undefined {
  return Object.values(state.nodes).find((node) => node.kind === "evidence" && node.fields?.observationId === observationId);
}

function evidenceDescriptor(evidence: NodeRecord | undefined): (NodeRecord & { sourceId: string; observationId: string }) | null {
  if (evidence === undefined || typeof evidence.fields?.sourceId !== "string" || typeof evidence.fields.observationId !== "string") return null;
  return { ...evidence, sourceId: evidence.fields.sourceId, observationId: evidence.fields.observationId };
}

async function handleCaptureSource(root: string, request: Extract<RuntimeRequest, { op: "capture_source" }>): Promise<RuntimeResponse> {
  const actor = requireActor(request);
  const loaded = await readHistory(root);
  const state = loaded.revision.state;
  const kb = request.kb ?? "shared";
  findKb(state, kb);
  const provider = new FileKnowledgeProvider(root);
  const resolved = await provider.resolve(request.locator);
  const fetched = await provider.fetch(resolved);
  const existing = sourceByLocator(state, resolved.locator, kb);
  const requestedSourceId = request.sourceId === undefined ? undefined : requireUuid(request.sourceId, "sourceId");
  if (requestedSourceId !== undefined && existing !== undefined && existing.id !== requestedSourceId) {
    throw new RuntimeError("CONFLICT", `source locator is already associated with ${existing.id}`, { locator: resolved.locator, sourceId: existing.id });
  }
  const sourceId = existing?.id ?? requestedSourceId ?? randomUUID();
  if (existing && sourceStateMatches(existing, fetched)) {
    const observation = existing.currentObservationId === undefined ? undefined : state.observations[existing.currentObservationId];
    const evidence = observation === undefined ? undefined : evidenceNodeForObservation(state, observation.id);
    return {
      revision: loaded.revision.revision,
      data: { source: existing, observation, evidence: evidenceDescriptor(evidence), changed: false, committed: false }
    };
  }
  const baseline = request.expectedRevision ?? loaded.revision.revision;
  const createdAt = atTime(request.at);
  type CaptureValue = { source: SourceRecord; observation: SourceObservation | undefined; evidence: (NodeRecord & { sourceId: string; observationId: string }) | null; changed: boolean; committed: boolean; recordedAtRevision?: number };
  return commitMutation<CaptureValue>(root, actor, "capture_source", baseline, (draftState, nextRevision) => {
    const draft = mutableState(draftState);
    const sources = draft.sources;
    const observations = draft.observations;
    const nodes = draft.nodes;
    const freshExisting = hasOwn(sources as Record<string, unknown>, sourceId) ? sources[sourceId] : undefined;
    if (freshExisting && sourceStateMatches(freshExisting, fetched)) {
      const observation = freshExisting.currentObservationId === undefined ? undefined : observations[freshExisting.currentObservationId];
      const evidence = observation === undefined ? undefined : Object.values(nodes).find((node) => node.kind === "evidence" && node.fields?.observationId === observation.id);
      return { state: draftState, value: { source: freshExisting, observation, evidence: evidenceDescriptor(evidence), changed: false, committed: false } };
    }
    const sourceNodeId = freshExisting?.nodeId ?? randomUUID();
    if (!freshExisting) {
      const sourceNode: NodeRecord = {
        id: sourceNodeId,
        kb,
        kind: "source",
        title: request.title?.trim() || `Source: ${resolved.locator}`,
        body: `Authoritative file source at ${resolved.locator}.`,
        fields: { sourceId, providerId: "file", locator: resolved.locator },
        createdBy: actor,
        createdAt
      };
      nodes[sourceNodeId] = sourceNode;
    }
    const observationId = randomUUID();
    const observation: SourceObservation = {
      id: observationId,
      sourceId,
      providerId: "file",
      locator: resolved.locator,
      providerRevision: fetched.providerRevision,
      digest: fetched.digest,
      observedText: fetched.text,
      observedBytesDigest: fetched.bytesDigest,
      availability: fetched.status,
      diagnostics: fetched.diagnostics,
      contentType: fetched.contentType,
      createdBy: actor,
      createdAt
    };
    observations[observationId] = observation;
    let evidence: NodeRecord | undefined;
    if (fetched.status === "present") {
      const evidenceId = randomUUID();
      evidence = {
        id: evidenceId,
        kb,
        kind: "evidence",
        title: `Observation: ${resolved.locator}`,
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
        createdBy: actor,
        createdAt
      };
      nodes[evidenceId] = evidence;
    }
    const source: SourceRecord = {
      id: sourceId,
      nodeId: sourceNodeId,
      kb: freshExisting?.kb ?? kb,
      providerId: "file",
      locator: resolved.locator,
      selector: freshExisting?.selector,
      currentObservationId: observationId,
      availability: fetched.status,
      providerRevision: fetched.providerRevision,
      currentDigest: fetched.digest,
      lastCheckedAt: createdAt,
      createdBy: freshExisting?.createdBy ?? actor,
      createdAt: freshExisting?.createdAt ?? createdAt
    };
    sources[sourceId] = source;
    const beforeObservationId = freshExisting?.currentObservationId;
    if (freshExisting && (beforeObservationId !== observationId || !sourceStateMatches(freshExisting, fetched))) {
      const change: ChangeRecord = {
        id: randomUUID(),
        sourceId,
        beforeObservationId,
        afterObservationId: observationId,
        beforeDigest: freshExisting.currentDigest,
        afterDigest: fetched.digest,
        beforeAvailability: freshExisting.availability,
        afterAvailability: fetched.status,
        reason: freshExisting.availability === "present" && fetched.status === "present" ? "content_changed" : "availability_changed",
        createdBy: actor,
        createdAt
      };
      draft.changes = [...draft.changes, change];
    }
    return {
      state: draftState,
      value: { source, observation, evidence: evidenceDescriptor(evidence), changed: true, committed: true, recordedAtRevision: nextRevision }
    };
  });
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
  const groups = normalizeGroups(request.groups);
  for (const group of groups) for (const premise of group.premises) visibleNode(state, premise, kb);
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
    if (source?.availability === "present" && observation?.availability === "present" && source.currentObservationId === observation.id && source.currentDigest === observation.digest) return { status: "usable", reason: "retained evidence matches the current source observation" };
    return { status: "pending", reason: "retained evidence is historical or its source is unavailable" };
  }
  const justifications = Object.values(state.justifications).filter((j) => j.conclusion === nodeId);
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

function collectUpstream(state: ProjectState, start: string): string[] {
  const result = new Set<string>();
  const visiting = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) return;
    visiting.add(nodeId);
    const node = nodeById(state, nodeId);
    for (const justification of Object.values(state.justifications).filter((j) => j.conclusion === nodeId).sort((a, b) => a.id.localeCompare(b.id))) {
      for (const group of justification.groups) {
        for (const premise of group.premises) {
          if (!result.has(premise)) result.add(premise);
          visit(premise);
        }
      }
    }
    if (node.kind === "evidence") {
      const source = currentSourceForNode(state, node);
      if (source !== undefined && !result.has(source.nodeId)) result.add(source.nodeId);
    }
    visiting.delete(nodeId);
  };
  visit(start);
  return [...result].sort((a, b) => a.localeCompare(b));
}

function provenanceFor(state: ProjectState, upstream: readonly string[]): Array<{ sourceId: string; observationId: string; observedText: string; providerRevision: string }> {
  const result = new Map<string, { sourceId: string; observationId: string; observedText: string; providerRevision: string }>();
  for (const id of upstream) {
    const node = state.nodes[id];
    if (node?.kind !== "evidence") continue;
    const source = currentSourceForNode(state, node);
    const observation = observationForEvidence(state, node);
    if (source === undefined || observation === undefined || observation.observedText === undefined || observation.providerRevision === undefined) continue;
    result.set(observation.id, { sourceId: source.id, observationId: observation.id, observedText: observation.observedText, providerRevision: observation.providerRevision });
  }
  return [...result.values()].sort((a, b) => a.observationId.localeCompare(b.observationId));
}

async function handleWhy(root: string, request: Extract<RuntimeRequest, { op: "why" }>): Promise<RuntimeResponse> {
  const revision = (await readHistory(root, request.revision)).revision;
  const state = revision.state;
  const node = visibleNode(state, request.nodeId, request.kb);
  const evaluationTime = atTime(request.evaluationTime ?? revision.committedAt);
  const justifications = Object.values(state.justifications).filter((j) => j.conclusion === node.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const originalId = node.fields?.originalBasisJustificationId;
  const originalJustification = typeof originalId === "string" && hasOwn(state.justifications as Record<string, unknown>, originalId) ? state.justifications[originalId] : undefined;
  const upstreamIds = collectUpstream(state, node.id);
  const support = assessNode(state, node.id, evaluationTime);
  const currentSupport = justifications.map((justification) => ({
    justification,
    groups: justification.groups.map((group) => ({ ...group, status: group.premises.every((premise) => assessNode(state, premise, evaluationTime).status === "usable") ? "usable" : "pending" })),
    assessment: assessApplicability(justification.applicability, evaluationTime)
  }));
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
      provenance: provenanceFor(state, upstreamIds)
    }
  };
}

/** Public dispatcher. Additional operations are added in bounded TDD slices. */
export async function executeOperation(rootInput: string, request: RuntimeRequest): Promise<RuntimeResponse> {
  const root = await canonicalRoot(rootInput);
  if (!request || typeof request !== "object" || typeof request.op !== "string") {
    throw new RuntimeError("INVALID_REQUEST", "request must contain an operation discriminant");
  }
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
    if (current.state.kbs[request.id]) throw new RuntimeError("CONFLICT", `knowledge base already exists: ${request.id}`, { id: request.id });
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
      if (state.kbs[request.id]) throw new RuntimeError("CONFLICT", `knowledge base already exists: ${request.id}`);
      const knowledgeBase: KnowledgeBaseRecord = { id: request.id, title: request.title.trim(), parent, createdBy: actor, createdAt };
      const nextState = { ...state, kbs: { ...state.kbs, [request.id]: knowledgeBase } } as ProjectState;
      return { state: nextState, value: kbDescriptor(root, knowledgeBase, false) };
    });
    return { revision: result.revision.revision, data: { knowledgeBase: result.value, committed: true } };
  }
  if (request.op === "capture_source") return handleCaptureSource(root, request);
  if (request.op === "record") return handleRecord(root, request);
  if (request.op === "justify") return handleJustify(root, request);
  if (request.op === "why") return handleWhy(root, request);
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
