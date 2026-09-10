import { lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";

import {
  canonicalJson,
  emptyState,
  HISTORY_FORMAT,
  HISTORY_VERSION,
  NODE_KINDS,
  RELATIONSHIP_TYPES,
  sha256,
  STATE_FORMAT,
  STATE_VERSION
} from "./domain.ts";
import type { HistoryRevision, ProjectState } from "./domain.ts";

export type StorageErrorCode =
  | "HISTORY_CORRUPT"
  | "CONCURRENT_WRITE"
  | "PROJECTION_FAILED"
  | "INVALID_HISTORY";

export class StorageError extends Error {
  readonly name = "StorageError";
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export type ProjectIdentity = {
  readonly id: string;
  readonly name: string;
};

export type LoadedHistory = {
  readonly root: string;
  readonly identity: ProjectIdentity;
  readonly revision: HistoryRevision;
};

const HISTORY_DIRECTORY = "justification-history";
const LOCK_FILE = ".lock";
const projectLockContext = new AsyncLocalStorage<ReadonlySet<string>>();

export function historyDirectory(root: string): string {
  return join(root, HISTORY_DIRECTORY);
}

async function assertSafeHistoryDirectory(root: string, create = false): Promise<string> {
  const directory = historyDirectory(root);
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new StorageError("HISTORY_CORRUPT", "cannot inspect the project history directory", { cause: error });
    }
    if (!create) return directory;
    try {
      await mkdir(directory);
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new StorageError("HISTORY_CORRUPT", "cannot create the project history directory", { cause: mkdirError });
      }
    }
    try {
      info = await lstat(directory);
    } catch (inspectError) {
      throw new StorageError("HISTORY_CORRUPT", "cannot inspect the project history directory", { cause: inspectError });
    }
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new StorageError("HISTORY_CORRUPT", "project history directory must be a real directory inside the project root");
  }
  return directory;
}

async function assertSafeEntry(path: string, label: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new StorageError("HISTORY_CORRUPT", `${label} must not be a symlink`);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new StorageError("HISTORY_CORRUPT", `cannot inspect ${label}`, { cause: error });
  }
}

function revisionFile(directory: string, revision: number): string {
  return join(directory, `${revision.toString().padStart(12, "0")}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

async function readIdentity(root: string): Promise<ProjectIdentity> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(root, "justification.json"), "utf8"));
    if (!isRecord(parsed) || parsed.format !== "justification.project" || parsed.version !== 1 || typeof parsed.id !== "string" || typeof parsed.name !== "string") {
      throw new Error("invalid project descriptor");
    }
    return { id: parsed.id, name: parsed.name };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("HISTORY_CORRUPT", "cannot read the project descriptor", { cause: error });
  }
}

function validateState(state: unknown, identity: ProjectIdentity): asserts state is ProjectState {
  if (!isRecord(state) || state.format !== STATE_FORMAT || state.version !== STATE_VERSION) {
    throw new StorageError("HISTORY_CORRUPT", "history contains an unsupported state format");
  }
  if (state.projectId !== identity.id || state.projectName !== identity.name) {
    throw new StorageError("HISTORY_CORRUPT", "history project identity does not match justification.json");
  }
  for (const key of ["kbs", "nodes", "sources", "observations", "justifications", "relationships"]) {
    if (!isRecord(state[key])) throw new StorageError("HISTORY_CORRUPT", `history state field ${key} is invalid`);
  }
  for (const key of ["changes", "contradictions", "reviews", "scopeChanges"]) {
    if (!Array.isArray(state[key])) throw new StorageError("HISTORY_CORRUPT", `history state field ${key} is invalid`);
  }
  if (state.artifactDrifts !== undefined && !Array.isArray(state.artifactDrifts)) {
    throw new StorageError("HISTORY_CORRUPT", "history state field artifactDrifts is invalid");
  }
  const kbs = state.kbs as Record<string, unknown>;
  if (!isRecord(kbs.shared) || (kbs.shared as Record<string, unknown>).parent !== null) {
    throw new StorageError("HISTORY_CORRUPT", "history is missing the shared knowledge base");
  }
  for (const [id, value] of Object.entries(kbs)) {
    if (!isRecord(value) || value.id !== id || typeof value.title !== "string" || typeof value.createdBy !== "string" || typeof value.createdAt !== "string") {
      throw new StorageError("HISTORY_CORRUPT", `history contains an invalid knowledge base: ${id}`);
    }
    const parent = value.parent;
    if (id === "shared") {
      if (parent !== null) throw new StorageError("HISTORY_CORRUPT", "shared knowledge base cannot have a parent");
    } else if (parent !== "shared" || typeof parent !== "string" || !hasOwn(kbs, parent)) {
      throw new StorageError("HISTORY_CORRUPT", `knowledge base ${id} has a missing parent`);
    }
  }
  const nodes = state.nodes as Record<string, Record<string, unknown>>;
  for (const [id, node] of Object.entries(nodes)) {
    if (!isRecord(node) || node.id !== id || typeof node.kb !== "string" || !hasOwn(kbs, node.kb) || typeof node.kind !== "string" || !NODE_KINDS.includes(node.kind as (typeof NODE_KINDS)[number])) {
      throw new StorageError("HISTORY_CORRUPT", "history contains a node with an invalid knowledge base");
    }
  }
  const sources = state.sources as Record<string, unknown>;
  const observations = state.observations as Record<string, unknown>;
  const justifications = state.justifications as Record<string, unknown>;
  const relationships = state.relationships as Record<string, unknown>;
  for (const [id, value] of Object.entries(sources)) {
    if (!isRecord(value) || value.id !== id || typeof value.nodeId !== "string" || !hasOwn(nodes, value.nodeId) || (nodes[value.nodeId]?.kind !== "source") || typeof value.kb !== "string" || !hasOwn(kbs, value.kb) || value.providerId !== "file" || typeof value.locator !== "string") {
      throw new StorageError("HISTORY_CORRUPT", `source ${id} has an invalid node or knowledge base reference`);
    }
    if (value.currentObservationId !== undefined && (typeof value.currentObservationId !== "string" || !hasOwn(observations, value.currentObservationId) || (observations[value.currentObservationId] as Record<string, unknown>).sourceId !== id)) {
      throw new StorageError("HISTORY_CORRUPT", `source ${id} has an invalid current observation reference`);
    }
  }
  for (const [id, value] of Object.entries(observations)) {
    if (!isRecord(value) || value.id !== id || typeof value.sourceId !== "string" || !hasOwn(sources, value.sourceId) || typeof value.providerId !== "string" || typeof value.locator !== "string" || !["present", "missing", "unavailable", "denied"].includes(String(value.availability))) {
      throw new StorageError("HISTORY_CORRUPT", `observation ${id} has an invalid source reference`);
    }
  }
  for (const [id, value] of Object.entries(justifications)) {
    if (!isRecord(value) || value.id !== id || typeof value.kb !== "string" || !hasOwn(kbs, value.kb) || typeof value.conclusion !== "string" || !hasOwn(nodes, value.conclusion) || !Array.isArray(value.groups) || value.groups.length === 0 || typeof value.rationale !== "string") {
      throw new StorageError("HISTORY_CORRUPT", `justification ${id} has an invalid conclusion or knowledge base reference`);
    }
    for (const group of value.groups) {
      if (!isRecord(group) || typeof group.id !== "string" || !Array.isArray(group.premises) || group.premises.length === 0) throw new StorageError("HISTORY_CORRUPT", `justification ${id} has an invalid premise group`);
      for (const premise of group.premises) {
        if (typeof premise !== "string" || !hasOwn(nodes, premise)) throw new StorageError("HISTORY_CORRUPT", `justification ${id} has a dangling premise reference`);
      }
    }
  }
  for (const [id, value] of Object.entries(relationships)) {
    if (!isRecord(value) || value.id !== id || typeof value.kb !== "string" || !hasOwn(kbs, value.kb) || typeof value.from !== "string" || !hasOwn(nodes, value.from) || typeof value.to !== "string" || !hasOwn(nodes, value.to) || typeof value.type !== "string" || !RELATIONSHIP_TYPES.includes(value.type as (typeof RELATIONSHIP_TYPES)[number])) {
      throw new StorageError("HISTORY_CORRUPT", `relationship ${id} has a dangling endpoint or invalid knowledge base reference`);
    }
    const from = nodes[value.from] as Record<string, unknown>;
    const to = nodes[value.to] as Record<string, unknown>;
    if (from.kb !== value.kb || (to.kb !== "shared" && to.kb !== value.kb)) {
      throw new StorageError("HISTORY_CORRUPT", `relationship ${id} crosses its owning knowledge-base scope`);
    }
  }
  for (const change of state.changes as unknown[]) {
    if (!isRecord(change) || typeof change.sourceId !== "string" || !hasOwn(sources, change.sourceId)) throw new StorageError("HISTORY_CORRUPT", "history contains a change with a dangling source reference");
    for (const key of ["beforeObservationId", "afterObservationId"]) {
      if (change[key] !== undefined && (typeof change[key] !== "string" || !hasOwn(observations, change[key]))) throw new StorageError("HISTORY_CORRUPT", "history contains a change with a dangling observation reference");
    }
  }
  const artifactDriftIds = new Set<string>();
  for (const drift of (state.artifactDrifts ?? []) as unknown[]) {
    if (!isRecord(drift) || typeof drift.id !== "string" || artifactDriftIds.has(drift.id) || typeof drift.artifactId !== "string" || !hasOwn(nodes, drift.artifactId) || (nodes[drift.artifactId] as Record<string, unknown>).kind !== "artifact" || typeof drift.locator !== "string" || !isRecord(drift.before) || !isRecord(drift.after) || !["content_changed", "availability_changed"].includes(String(drift.reason))) {
      throw new StorageError("HISTORY_CORRUPT", "history contains an artifact drift with an invalid artifact reference or state");
    }
    artifactDriftIds.add(drift.id);
    for (const stateValue of [drift.before, drift.after]) {
      if (!isRecord(stateValue) || !["present", "missing", "unavailable", "denied"].includes(String(stateValue.status))) {
        throw new StorageError("HISTORY_CORRUPT", "history contains an artifact drift with an invalid file state");
      }
      for (const key of ["digest", "bytesDigest", "diagnostics"]) {
        if (stateValue[key] !== undefined && typeof stateValue[key] !== "string") {
          throw new StorageError("HISTORY_CORRUPT", "history contains an artifact drift with invalid file state metadata");
        }
      }
    }
  }
  for (const contradiction of state.contradictions as unknown[]) {
    if (!isRecord(contradiction) || typeof contradiction.id !== "string" || typeof contradiction.kb !== "string" || !hasOwn(kbs, contradiction.kb) || typeof contradiction.left !== "string" || !hasOwn(nodes, contradiction.left) || typeof contradiction.right !== "string" || !hasOwn(nodes, contradiction.right) || contradiction.left === contradiction.right || typeof contradiction.rationale !== "string" || !["open", "resolved"].includes(String(contradiction.status))) {
      throw new StorageError("HISTORY_CORRUPT", "history contains a contradiction with a dangling node reference or invalid state");
    }
    const left = nodes[contradiction.left] as Record<string, unknown>;
    const right = nodes[contradiction.right] as Record<string, unknown>;
    if ((contradiction.kb === "shared" && (left.kb !== "shared" || right.kb !== "shared")) || (contradiction.kb !== "shared" && left.kb !== "shared" && left.kb !== contradiction.kb) || (contradiction.kb !== "shared" && right.kb !== "shared" && right.kb !== contradiction.kb)) {
      throw new StorageError("HISTORY_CORRUPT", "history contains a contradiction outside its owning knowledge-base scope");
    }
    if (contradiction.resolution !== undefined && !["supersession", "different_scope", "different_time", "source_error", "unresolved"].includes(String(contradiction.resolution))) {
      throw new StorageError("HISTORY_CORRUPT", "history contains a contradiction with an invalid resolution");
    }
    if (contradiction.status === "resolved" && contradiction.resolution === undefined) {
      throw new StorageError("HISTORY_CORRUPT", "resolved contradiction is missing its resolution");
    }
    if (contradiction.resolution === "unresolved" && contradiction.status !== "open") {
      throw new StorageError("HISTORY_CORRUPT", "unresolved contradiction must remain open");
    }
    if (contradiction.resolution === "supersession" && contradiction.winnerId === undefined) {
      throw new StorageError("HISTORY_CORRUPT", "superseded contradiction is missing its winner");
    }
    if (contradiction.resolution !== "supersession" && contradiction.winnerId !== undefined) {
      throw new StorageError("HISTORY_CORRUPT", "contradiction winner is only valid for supersession");
    }
    if (contradiction.winnerId !== undefined && (typeof contradiction.winnerId !== "string" || (contradiction.winnerId !== contradiction.left && contradiction.winnerId !== contradiction.right))) {
      throw new StorageError("HISTORY_CORRUPT", "history contains a contradiction with an invalid supersession winner");
    }
    if (contradiction.resolutionHistory !== undefined) {
      if (!Array.isArray(contradiction.resolutionHistory)) throw new StorageError("HISTORY_CORRUPT", "history contains a contradiction with invalid resolution history");
      for (const entry of contradiction.resolutionHistory) {
        if (!isRecord(entry) || !["supersession", "different_scope", "different_time", "source_error", "unresolved"].includes(String(entry.resolution)) || typeof entry.actor !== "string" || typeof entry.at !== "string" || typeof entry.rationale !== "string") {
          throw new StorageError("HISTORY_CORRUPT", "history contains a contradiction with invalid resolution history");
        }
        if (entry.winnerId !== undefined && (typeof entry.winnerId !== "string" || (entry.winnerId !== contradiction.left && entry.winnerId !== contradiction.right))) {
          throw new StorageError("HISTORY_CORRUPT", "history contains a contradiction with an invalid resolution winner");
        }
        if (entry.resolution === "supersession" && entry.winnerId === undefined) {
          throw new StorageError("HISTORY_CORRUPT", "history contains a supersession without a winner");
        }
        if (entry.resolution !== "supersession" && entry.winnerId !== undefined) {
          throw new StorageError("HISTORY_CORRUPT", "history contains a non-supersession winner");
        }
      }
    }
  }
  for (const review of state.reviews as unknown[]) {
    if (!isRecord(review) || typeof review.id !== "string" || typeof review.nodeId !== "string" || !hasOwn(nodes, review.nodeId) || typeof review.triggerId !== "string" || !["change", "contradiction", "artifact_drift", "promotion_conflict"].includes(String(review.triggerType)) || !["open", "closed"].includes(String(review.status))) throw new StorageError("HISTORY_CORRUPT", "history contains a review with a dangling node reference or invalid state");
    if (review.kb !== undefined && (typeof review.kb !== "string" || !hasOwn(kbs, review.kb))) {
      throw new StorageError("HISTORY_CORRUPT", "history contains a review with an invalid owning knowledge base");
    }
    if (review.triggerType === "artifact_drift" && state.artifactDrifts !== undefined && !artifactDriftIds.has(review.triggerId)) {
      throw new StorageError("HISTORY_CORRUPT", "artifact drift review has a dangling trigger reference");
    }
    if (review.status === "closed" && (typeof review.closedBy !== "string" || typeof review.closedAt !== "string" || typeof review.closureRationale !== "string")) {
      throw new StorageError("HISTORY_CORRUPT", "closed review is missing closure metadata");
    }
    if (review.closureHistory !== undefined) {
      if (!Array.isArray(review.closureHistory) || review.closureHistory.length === 0 || review.status !== "closed") throw new StorageError("HISTORY_CORRUPT", "history contains a review with invalid closure history");
      for (const closure of review.closureHistory) {
        if (!isRecord(closure) || closure.status !== "closed" || typeof closure.actor !== "string" || typeof closure.at !== "string" || typeof closure.rationale !== "string") {
          throw new StorageError("HISTORY_CORRUPT", "history contains a review with invalid closure history");
        }
      }
    }
  }
  for (const change of state.scopeChanges as unknown[]) {
    if (!isRecord(change) || typeof change.nodeId !== "string" || !hasOwn(nodes, change.nodeId) || typeof change.from !== "string" || !hasOwn(kbs, change.from) || typeof change.to !== "string" || !hasOwn(kbs, change.to)) throw new StorageError("HISTORY_CORRUPT", "history contains a scope change with a dangling reference");
  }
}

function validateRevision(value: unknown, identity: ProjectIdentity, expectedRevision: number, previous: HistoryRevision | null): HistoryRevision {
  if (!isRecord(value) || value.format !== HISTORY_FORMAT || value.version !== HISTORY_VERSION || value.revision !== expectedRevision) {
    throw new StorageError("HISTORY_CORRUPT", `history revision ${expectedRevision} has an invalid envelope`);
  }
  if (typeof value.actor !== "string" || typeof value.action !== "string" || typeof value.committedAt !== "string" || typeof value.integrity !== "string") {
    throw new StorageError("HISTORY_CORRUPT", `history revision ${expectedRevision} has invalid metadata`);
  }
  if (value.previousRevision !== (previous?.revision ?? null) || value.previousDigest !== (previous?.integrity ?? null)) {
    throw new StorageError("HISTORY_CORRUPT", `history revision ${expectedRevision} has a broken parent chain`);
  }
  validateState(value.state, identity);
  const unsigned = { ...value } as Record<string, unknown>;
  delete unsigned.integrity;
  if (sha256(canonicalJson(unsigned)) !== value.integrity) {
    throw new StorageError("HISTORY_CORRUPT", `history revision ${expectedRevision} failed integrity validation`);
  }
  return value as unknown as HistoryRevision;
}

async function listRevisionNumbers(directory: string): Promise<number[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((name) => /^\d{12}\.json$/.test(name))
    .map((name) => Number.parseInt(name.slice(0, -5), 10))
    .sort((a, b) => a - b);
}

async function readRevisionFile(directory: string, revision: number): Promise<unknown> {
  try {
    await assertSafeEntry(revisionFile(directory, revision), `history revision ${revision}`);
    return JSON.parse(await readFile(revisionFile(directory, revision), "utf8")) as unknown;
  } catch (error) {
    throw new StorageError("HISTORY_CORRUPT", `cannot read history revision ${revision}`, { cause: error });
  }
}

export async function readHistory(root: string, atRevision?: number): Promise<LoadedHistory> {
  const identity = await readIdentity(root);
  const directory = await assertSafeHistoryDirectory(root);
  const revisions = await listRevisionNumbers(directory);
  if (revisions.length === 0) {
    await ensureHistory(root, identity);
    return readHistory(root, atRevision);
  }
  let previous: HistoryRevision | null = null;
  let selected: HistoryRevision | null = null;
  for (const number of revisions) {
    const revision = validateRevision(await readRevisionFile(directory, number), identity, number, previous);
    previous = revision;
    if (atRevision === undefined || atRevision === number) selected = revision;
    if (atRevision !== undefined && number >= atRevision) break;
  }
  if (!previous || !selected || (atRevision !== undefined && selected.revision !== atRevision)) {
    throw new StorageError("INVALID_HISTORY", `requested history revision ${String(atRevision)} does not exist`);
  }
  return { root, identity, revision: selected };
}

export async function ensureHistory(root: string, identity?: ProjectIdentity): Promise<LoadedHistory> {
  const resolvedIdentity = identity ?? await readIdentity(root);
  const directory = await assertSafeHistoryDirectory(root, true);
  const revisions = await listRevisionNumbers(directory);
  if (revisions.length > 0) return readHistory(root);
  const state = emptyState(resolvedIdentity.id, resolvedIdentity.name);
  const unsigned = {
    format: HISTORY_FORMAT,
    version: HISTORY_VERSION,
    revision: 0,
    previousRevision: null,
    previousDigest: null,
    actor: "system",
    action: "initialize",
    committedAt: new Date().toISOString(),
    state
  };
  const revision: HistoryRevision = { ...unsigned, integrity: sha256(canonicalJson(unsigned)) };
  try {
    await writeFile(revisionFile(directory, 0), `${JSON.stringify(revision, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readHistory(root);
}

export type TransactionResult<T> = {
  readonly revision: HistoryRevision;
  readonly value: T;
  readonly committed: boolean;
};

type TransactionMutation<T> = {
  readonly state: ProjectState;
  readonly value: T;
  /** A mutation may return false when an already-committed request is idempotent. */
  readonly committed?: boolean;
};

export class PostCommitError extends Error {
  readonly name = "PostCommitError";
  readonly revision: HistoryRevision;
  readonly value: unknown;

  constructor(revision: HistoryRevision, value: unknown, cause: unknown) {
    super(`post-commit processing failed for revision ${revision.revision}`, { cause });
    this.revision = revision;
    this.value = value;
  }
}

/**
 * Serialize any operation that reads durable history and writes project state.
 * The async-local context makes projection publication from a transaction
 * re-entrant without allowing an unrelated process to pass an existing lock.
 */
export async function withProjectLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const active = projectLockContext.getStore();
  if (active?.has(root) === true) return operation();

  await ensureHistory(root);
  const directory = await assertSafeHistoryDirectory(root);
  const lockPath = join(directory, LOCK_FILE);
  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await assertSafeEntry(lockPath, "project history lock");
    lockHandle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new StorageError("CONCURRENT_WRITE", "another project write is in progress; remove the lock only after confirming no writer remains");
    }
    throw error;
  }
  const nextContext = new Set(active);
  nextContext.add(root);
  try {
    return await projectLockContext.run(nextContext, operation);
  } finally {
    await lockHandle.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export async function transact<T>(
  root: string,
  actor: string,
  action: string,
  mutate: (state: ProjectState, nextRevision: number) => TransactionMutation<T>,
  afterCommit?: (revision: HistoryRevision, value: T) => Promise<void>
): Promise<TransactionResult<T>> {
  await ensureHistory(root);
  return withProjectLock(root, async () => {
    const directory = await assertSafeHistoryDirectory(root);
    const fresh = await readHistory(root);
    const nextRevision = fresh.revision.revision + 1;
    const proposed = mutate(structuredClone(fresh.revision.state), nextRevision);
    if (proposed.committed === false) {
      return { revision: fresh.revision, value: proposed.value, committed: false };
    }
    validateState(proposed.state, fresh.identity);
    const unsigned = {
      format: HISTORY_FORMAT,
      version: HISTORY_VERSION,
      revision: nextRevision,
      previousRevision: fresh.revision.revision,
      previousDigest: fresh.revision.integrity,
      actor,
      action,
      committedAt: new Date().toISOString(),
      state: proposed.state
    };
    const revision: HistoryRevision = { ...unsigned, integrity: sha256(canonicalJson(unsigned)) };
    const temporary = `${revisionFile(directory, nextRevision)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await assertSafeEntry(revisionFile(directory, nextRevision), `history revision ${nextRevision}`);
    await writeFile(temporary, `${JSON.stringify(revision, null, 2)}\n`, "utf8");
    await rename(temporary, revisionFile(directory, nextRevision));
    if (afterCommit !== undefined) {
      try {
        await afterCommit(revision, proposed.value);
      } catch (error) {
        throw new PostCommitError(revision, proposed.value, error);
      }
    }
    return { revision, value: proposed.value, committed: true };
  });
}

export async function historyRevisions(root: string): Promise<HistoryRevision[]> {
  const identity = await readIdentity(root);
  const directory = await assertSafeHistoryDirectory(root);
  const revisions = await listRevisionNumbers(directory);
  const result: HistoryRevision[] = [];
  let previous: HistoryRevision | null = null;
  for (const number of revisions) {
    const revision = validateRevision(await readRevisionFile(directory, number), identity, number, previous);
    result.push(revision);
    previous = revision;
  }
  return result;
}

export async function validateHistory(root: string): Promise<HistoryRevision> {
  return (await readHistory(root)).revision;
}

export async function assertHistoryDirectory(root: string): Promise<void> {
  await assertSafeHistoryDirectory(root);
}
