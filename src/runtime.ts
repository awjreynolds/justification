import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import {
  NODE_KINDS,
  RELATIONSHIP_TYPES,
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
  | { op: "export"; kb?: string; outputDir?: string };

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
  const kb = state.kbs[id];
  if (!kb) throw new RuntimeError("NOT_FOUND", `knowledge base not found: ${id}`, { id });
  return kb;
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
  throw new RuntimeError("INVALID_REQUEST", `unsupported runtime operation: ${request.op}`);
}

export { NODE_KINDS, RELATIONSHIP_TYPES };
