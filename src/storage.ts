import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  canonicalJson,
  emptyState,
  HISTORY_FORMAT,
  HISTORY_VERSION,
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

export function historyDirectory(root: string): string {
  return join(root, HISTORY_DIRECTORY);
}

function revisionFile(directory: string, revision: number): string {
  return join(directory, `${revision.toString().padStart(12, "0")}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const kbs = state.kbs as Record<string, unknown>;
  if (!isRecord(kbs.shared) || (kbs.shared as Record<string, unknown>).parent !== null) {
    throw new StorageError("HISTORY_CORRUPT", "history is missing the shared knowledge base");
  }
  const nodes = state.nodes as Record<string, Record<string, unknown>>;
  for (const node of Object.values(nodes)) {
    if (!isRecord(node) || typeof node.id !== "string" || typeof node.kb !== "string" || !isRecord(kbs[node.kb])) {
      throw new StorageError("HISTORY_CORRUPT", "history contains a node with an invalid knowledge base");
    }
  }
  const references: Array<[string, unknown]> = [];
  for (const [id, source] of Object.entries(state.sources as Record<string, unknown>)) references.push([`source ${id}`, source]);
  for (const [id, observation] of Object.entries(state.observations as Record<string, unknown>)) references.push([`observation ${id}`, observation]);
  for (const [id, justification] of Object.entries(state.justifications as Record<string, unknown>)) references.push([`justification ${id}`, justification]);
  for (const [id, relationship] of Object.entries(state.relationships as Record<string, unknown>)) references.push([`relationship ${id}`, relationship]);
  for (const [label, value] of references) {
    if (!isRecord(value)) throw new StorageError("HISTORY_CORRUPT", `history contains an invalid ${label}`);
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
    return JSON.parse(await readFile(revisionFile(directory, revision), "utf8")) as unknown;
  } catch (error) {
    throw new StorageError("HISTORY_CORRUPT", `cannot read history revision ${revision}`, { cause: error });
  }
}

export async function readHistory(root: string, atRevision?: number): Promise<LoadedHistory> {
  const identity = await readIdentity(root);
  const directory = historyDirectory(root);
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
  const directory = historyDirectory(root);
  await mkdir(directory, { recursive: true });
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

export async function transact<T>(
  root: string,
  actor: string,
  action: string,
  mutate: (state: ProjectState, nextRevision: number) => { state: ProjectState; value: T }
): Promise<TransactionResult<T>> {
  const current = await ensureHistory(root);
  const directory = historyDirectory(root);
  const lockPath = join(directory, LOCK_FILE);
  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    lockHandle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new StorageError("CONCURRENT_WRITE", "another project write is in progress; remove the lock only after confirming no writer remains");
    }
    throw error;
  }
  try {
    const fresh = await readHistory(root);
    const nextRevision = fresh.revision.revision + 1;
    const proposed = mutate(structuredClone(fresh.revision.state), nextRevision);
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
    await writeFile(temporary, `${JSON.stringify(revision, null, 2)}\n`, "utf8");
    await rename(temporary, revisionFile(directory, nextRevision));
    return { revision, value: proposed.value, committed: true };
  } finally {
    await lockHandle.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export async function historyRevisions(root: string): Promise<HistoryRevision[]> {
  const identity = await readIdentity(root);
  const directory = historyDirectory(root);
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
  const directory = historyDirectory(root);
  try {
    if (!(await stat(directory)).isDirectory()) throw new StorageError("HISTORY_CORRUPT", `${HISTORY_DIRECTORY} is not a directory`);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("HISTORY_CORRUPT", `${HISTORY_DIRECTORY} is unavailable`, { cause: error });
  }
}
