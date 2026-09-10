import { buildSupportTree } from "./support-tree.ts";
import type { SupportTree } from "./support-tree.ts";
import type { HistoryRevision, NodeRecord, NodeKind, ProjectState } from "./domain.ts";
import type { RuntimeRequest, RuntimeResponse } from "./runtime.ts";
import { reviewVisibleInKb } from "./review-scope.ts";

export type QueryAssessment = {
  readonly status: "usable" | "pending" | "unusable";
  readonly reason: string;
};

/**
 * Runtime-owned semantics supplied to read queries without a value import
 * back into the dispatcher. Query code must not implement another evaluator.
 */
export type QueryServices = {
  readonly assessNode: (state: ProjectState, nodeId: string, evaluationTime: string) => QueryAssessment;
};

type ReadQueryRequest = Extract<RuntimeRequest, { op: "search" | "context" | "trace" }>;

export type QueryNode = {
  readonly id: string;
  readonly kb: string;
  readonly kind: NodeKind;
  readonly title: string;
  readonly snippet: string;
};

export type QueryFlags = {
  readonly supported: boolean;
  readonly assumed: boolean;
  readonly disputed: boolean;
  readonly pending: boolean;
};

export type QueryResult = QueryNode & {
  readonly flags: QueryFlags;
  readonly support: QueryAssessment;
  readonly reviewRequired: boolean;
  readonly openReviewIds: readonly string[];
};

export type QueryScope = { readonly kb: string | null };

export type SearchData = {
  readonly query: string;
  readonly scope: QueryScope;
  readonly results: readonly QueryResult[];
  readonly truncated: boolean;
};

export type ContextData = {
  readonly scope: QueryScope;
  readonly anchor: { readonly id: string; readonly kind: NodeKind } | null;
  readonly results: readonly QueryResult[];
  readonly truncated: boolean;
};

export type TraceResult = QueryNode & {
  readonly paths: readonly (readonly string[])[];
  readonly reasons: readonly string[];
};

export type TraceData = {
  readonly scope: QueryScope;
  readonly root: QueryNode;
  readonly direction: "upstream" | "downstream";
  readonly results: readonly TraceResult[];
  readonly truncated: boolean;
};

export type QueryErrorCode = "INVALID_REQUEST" | "NOT_FOUND" | "SCOPE_VIOLATION";

export class QueryError extends Error {
  readonly name = "QueryError";
  readonly code: QueryErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: QueryErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_QUERY_BUDGET_BYTES = 32 * 1024;
const MAX_SNIPPET_CHARACTERS = 240;

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalized(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function collapsed(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function snippetFor(node: NodeRecord): string {
  const text = collapsed(node.body) || collapsed(node.title);
  const characters = Array.from(text);
  if (characters.length <= MAX_SNIPPET_CHARACTERS) return text;
  return `${characters.slice(0, MAX_SNIPPET_CHARACTERS - 1).join("")}…`;
}

function occurrenceCount(text: string, term: string): number {
  let count = 0;
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(term, offset);
    if (index < 0) break;
    count += 1;
    offset = index + term.length;
  }
  return count;
}

function visibleNodes(state: ProjectState, kb: string | undefined): NodeRecord[] {
  if (kb !== undefined && !hasOwn(state.kbs as Record<string, unknown>, kb)) {
    throw new QueryError("NOT_FOUND", `knowledge base not found: ${kb}`, { id: kb });
  }
  return Object.values(state.nodes)
    .filter((node) => kb === undefined || node.kb === "shared" || node.kb === kb)
    .sort((left, right) => lexicalCompare(left.id, right.id));
}

function searchTerms(query: string): { readonly query: string; readonly terms: readonly string[] } {
  const trimmed = query.trim();
  if (trimmed.length === 0) throw new QueryError("INVALID_REQUEST", "search query must contain non-whitespace text");
  const terms = normalized(trimmed).split(/\s+/u).filter((term) => term.length > 0);
  if (terms.length === 0) throw new QueryError("INVALID_REQUEST", "search query must contain at least one term");
  return { query: trimmed, terms };
}

function envelopeBytes(revision: number, data: unknown): number {
  return Buffer.byteLength(JSON.stringify({ revision, data }), "utf8");
}

function queryBudget(value: number | undefined): number {
  const budget = value ?? DEFAULT_QUERY_BUDGET_BYTES;
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new QueryError("INVALID_REQUEST", "query budget must be a positive integer", { budget });
  }
  return budget;
}

type BudgetedResults = { readonly results: readonly unknown[]; readonly truncated: boolean };

function fitResults<T extends BudgetedResults>(
  revision: HistoryRevision,
  base: Omit<T, "results" | "truncated">,
  candidates: readonly T["results"][number][],
  requestedBudget: number
): T {
  const empty = { ...base, results: [], truncated: false } as unknown as T;
  const emptyTruncated = { ...base, results: [], truncated: true } as unknown as T;
  const minimumBudget = Math.max(envelopeBytes(revision.revision, empty), envelopeBytes(revision.revision, emptyTruncated));
  if (requestedBudget < minimumBudget) {
    throw new QueryError(
      "INVALID_REQUEST",
      `query budget is too small for the empty response envelope; minimum is ${minimumBudget} UTF-8 bytes`,
      { budget: requestedBudget, minimumBudget }
    );
  }
  if (candidates.length === 0) return empty;

  const results: T["results"][number][] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const isLast = index === candidates.length - 1;
    const candidateData = {
      ...base,
      results: [...results, candidates[index]],
      truncated: !isLast
    } as unknown as T;
    if (envelopeBytes(revision.revision, candidateData) > requestedBudget) {
      return { ...base, results, truncated: true } as unknown as T;
    }
    results.push(candidates[index]);
  }
  return { ...base, results, truncated: false } as unknown as T;
}

function isOpenlyDisputed(state: ProjectState, nodeId: string, kb?: string): boolean {
  return state.contradictions.some((contradiction) =>
    contradiction.status === "open" &&
    (kb === undefined || contradiction.kb === "shared" || contradiction.kb === kb) &&
    (contradiction.left === nodeId || contradiction.right === nodeId)
  );
}

function reviewVisibleInScope(state: ProjectState, review: ProjectState["reviews"][number], kb?: string): boolean {
  return reviewVisibleInKb(state, review, kb);
}

function openReviewIds(state: ProjectState, nodeId: string, kb?: string): string[] {
  return state.reviews
    .filter((review) => review.status === "open" && review.nodeId === nodeId && reviewVisibleInScope(state, review, kb))
    .map((review) => review.id)
    .sort(lexicalCompare);
}

function summarizeNode(
  state: ProjectState,
  node: NodeRecord,
  evaluationTime: string,
  services: QueryServices,
  kb?: string
): QueryResult {
  const support = services.assessNode(state, node.id, evaluationTime);
  const reviewIds = openReviewIds(state, node.id, kb);
  return {
    id: node.id,
    kb: node.kb,
    kind: node.kind,
    title: node.title,
    snippet: snippetFor(node),
    flags: {
      supported: support.status === "usable",
      assumed: node.kind === "assumption",
      disputed: isOpenlyDisputed(state, node.id, kb),
      pending: support.status === "pending"
    },
    support,
    reviewRequired: reviewIds.length > 0,
    openReviewIds: reviewIds
  };
}

function executeSearch(
  revision: HistoryRevision,
  request: Extract<ReadQueryRequest, { op: "search" }>,
  services: QueryServices
): RuntimeResponse<SearchData> {
  const { query, terms } = searchTerms(request.query);
  const budget = queryBudget(request.budget);
  const candidates = visibleNodes(revision.state, request.kb)
    .map((node) => {
      const searchable = normalized(`${node.title}\n${node.body}`);
      if (!terms.every((term) => searchable.includes(term))) return undefined;
      const score = terms.reduce((total, term) => total + occurrenceCount(searchable, term), 0);
      const result = summarizeNode(revision.state, node, revision.committedAt, services, request.kb);
      return { result, score };
    })
    .filter((candidate): candidate is { result: QueryResult; score: number } => candidate !== undefined)
    .sort((left, right) =>
      right.score - left.score ||
      lexicalCompare(left.result.title, right.result.title) ||
      lexicalCompare(left.result.id, right.result.id)
    )
    .map((candidate) => candidate.result);

  const data = fitResults<SearchData>(
    revision,
    { query, scope: { kb: request.kb ?? null } },
    candidates,
    budget
  );
  return { revision: revision.revision, data };
}

function nodeInScope(state: ProjectState, nodeId: string, kb: string | undefined): NodeRecord {
  const node = state.nodes[nodeId];
  if (node === undefined) throw new QueryError("NOT_FOUND", `node not found: ${nodeId}`, { id: nodeId });
  if (kb !== undefined) {
    if (!hasOwn(state.kbs as Record<string, unknown>, kb)) {
      throw new QueryError("NOT_FOUND", `knowledge base not found: ${kb}`, { id: kb });
    }
    if (node.kb !== "shared" && node.kb !== kb) {
      throw new QueryError("SCOPE_VIOLATION", `node ${nodeId} is outside knowledge base ${kb}`, { id: nodeId, kb });
    }
  }
  return node;
}

function visibleInScope(node: NodeRecord, kb: string | undefined): boolean {
  return kb === undefined || node.kb === "shared" || node.kb === kb;
}

type ContextCandidate = { readonly node: NodeRecord; readonly depth: number };

function collectContextCandidates(state: ProjectState, tree: SupportTree): ContextCandidate[] {
  const candidates = new Map<string, ContextCandidate>();
  const visit = (current: SupportTree, depth: number): void => {
    const add = (node: NodeRecord | undefined, nodeDepth: number): void => {
      if (node === undefined || node.id === tree.node.id) return;
      const existing = candidates.get(node.id);
      if (existing === undefined || nodeDepth < existing.depth) candidates.set(node.id, { node, depth: nodeDepth });
    };
    add(current.sourceNode, depth + 1);
    for (const justification of current.justifications) {
      for (const group of justification.groups) {
        for (const premise of group.premises) {
          add(state.nodes[premise.id], depth + 1);
          if (premise.tree !== undefined) visit(premise.tree, depth + 1);
        }
      }
    }
  };
  visit(tree, 0);
  return [...candidates.values()];
}

function contextKindRank(kind: NodeKind): number {
  if (kind === "claim") return 0;
  if (kind === "assumption" || kind === "requirement" || kind === "question" || kind === "option") return 1;
  if (kind === "evidence" || kind === "source") return 2;
  return 3;
}

function executeContext(
  revision: HistoryRevision,
  request: Extract<ReadQueryRequest, { op: "context" }>,
  services: QueryServices
): RuntimeResponse<ContextData> {
  if (request.nodeId === undefined && request.query === undefined) {
    throw new QueryError("INVALID_REQUEST", "context requires nodeId or query");
  }
  const anchor = request.nodeId === undefined ? undefined : nodeInScope(revision.state, request.nodeId, request.kb);
  const scopeKb = request.kb ?? anchor?.kb;
  const evaluationTime = request.evaluationTime ?? revision.committedAt;
  const queryTerms = request.query === undefined ? [] : searchTerms(request.query).terms;
  let candidates: ContextCandidate[];
  if (anchor !== undefined) {
    const tree = buildSupportTree(revision.state, anchor.id);
    candidates = collectContextCandidates(revision.state, tree)
      .filter(({ node }) => visibleInScope(node, request.kb))
      .filter(({ node }) => queryTerms.length === 0 || queryTerms.every((term) => normalized(`${node.title}\n${node.body}`).includes(term)));
  } else {
    candidates = visibleNodes(revision.state, request.kb)
      .filter((node) => {
        const searchable = normalized(`${node.title}\n${node.body}`);
        return queryTerms.every((term) => searchable.includes(term));
      })
      .map((node) => ({ node, depth: 0 }));
  }
  const results = candidates
    .map(({ node, depth }) => ({ result: summarizeNode(revision.state, node, evaluationTime, services, scopeKb), depth }))
    .sort((left, right) =>
      contextKindRank(left.result.kind) - contextKindRank(right.result.kind) ||
      left.depth - right.depth ||
      lexicalCompare(left.result.title, right.result.title) ||
      lexicalCompare(left.result.id, right.result.id)
    )
    .map(({ result }) => result);
  const data = fitResults<ContextData>(
    revision,
    { scope: { kb: scopeKb ?? null }, anchor: anchor === undefined ? null : { id: anchor.id, kind: anchor.kind } },
    results,
    queryBudget(request.budget)
  );
  return { revision: revision.revision, data };
}

type TraceEdge = { readonly to: string; readonly reason: string };

function traceEdges(state: ProjectState, nodeId: string, kb: string | undefined, direction: "upstream" | "downstream"): TraceEdge[] {
  const edges: TraceEdge[] = [];
  const add = (from: string, to: string, reason: string): void => {
    if (from !== nodeId) return;
    const target = state.nodes[to];
    if (target === undefined || !visibleInScope(target, kb)) return;
    edges.push({ to, reason });
  };
  for (const justification of Object.values(state.justifications)) {
    if (!hasOwn(state.nodes as Record<string, unknown>, justification.conclusion)) continue;
    if (kb !== undefined && justification.kb !== "shared" && justification.kb !== kb) continue;
    for (const group of justification.groups) {
      for (const premise of group.premises) {
        if (direction === "upstream") add(justification.conclusion, premise, "declared basis");
        else add(premise, justification.conclusion, "declared basis");
      }
    }
  }
  for (const node of Object.values(state.nodes)) {
    const sourceId = node.fields?.sourceId;
    if (node.kind !== "evidence" || typeof sourceId !== "string") continue;
    const source = state.sources[sourceId];
    if (source === undefined) continue;
    const sourceNode = state.nodes[source.nodeId];
    if (sourceNode === undefined) continue;
    if (direction === "upstream") add(node.id, sourceNode.id, "source provenance");
    else add(sourceNode.id, node.id, "source provenance");
  }
  for (const relationship of Object.values(state.relationships)) {
    if (kb !== undefined && relationship.kb !== "shared" && relationship.kb !== kb) continue;
    const reason = `typed relationship: ${relationship.type}`;
    if (direction === "upstream") add(relationship.from, relationship.to, reason);
    else add(relationship.to, relationship.from, reason);
  }
  return edges.sort((left, right) => lexicalCompare(left.to, right.to) || lexicalCompare(left.reason, right.reason));
}

function executeTrace(
  revision: HistoryRevision,
  request: Extract<ReadQueryRequest, { op: "trace" }>
): RuntimeResponse<TraceData> {
  const root = nodeInScope(revision.state, request.nodeId, request.kb);
  const direction = request.direction ?? "upstream";
  const paths = new Map<string, string[][]>();
  const reasons = new Map<string, Set<string>>();
  const visit = (current: string, path: string[], pathReasons: readonly string[]): void => {
    for (const edge of traceEdges(revision.state, current, request.kb, direction)) {
      if (path.includes(edge.to)) continue;
      const nextPath = [...path, edge.to];
      const existingPaths = paths.get(edge.to) ?? [];
      if (!existingPaths.some((candidate) => candidate.length === nextPath.length && candidate.every((id, index) => id === nextPath[index]))) existingPaths.push(nextPath);
      paths.set(edge.to, existingPaths);
      const existingReasons = reasons.get(edge.to) ?? new Set<string>();
      for (const reason of [...pathReasons, edge.reason]) existingReasons.add(reason);
      reasons.set(edge.to, existingReasons);
      visit(edge.to, nextPath, [...pathReasons, edge.reason]);
    }
  };
  visit(root.id, [root.id], []);
  const results = [...paths.keys()]
    .map((id) => {
      const node = revision.state.nodes[id];
      return {
        id: node.id,
        kb: node.kb,
        kind: node.kind,
        title: node.title,
        snippet: snippetFor(node),
        paths: paths.get(id) ?? [],
        reasons: [...(reasons.get(id) ?? new Set<string>())].sort(lexicalCompare)
      } satisfies TraceResult;
    })
    .sort((left, right) => lexicalCompare(left.id, right.id));
  const data = fitResults<TraceData>(
    revision,
    {
      scope: { kb: request.kb ?? null },
      root: { id: root.id, kb: root.kb, kind: root.kind, title: root.title, snippet: snippetFor(root) },
      direction
    },
    results,
    queryBudget(request.budget)
  );
  return { revision: revision.revision, data };
}

/** Execute one read query against the already validated current revision. */
export function executeReadQuery(
  revision: HistoryRevision,
  request: ReadQueryRequest,
  services: QueryServices
): RuntimeResponse<SearchData | ContextData | TraceData> {
  if (request.op === "search") return executeSearch(revision, request, services);
  if (request.op === "context") return executeContext(revision, request, services);
  if (request.op === "trace") return executeTrace(revision, request);
  throw new QueryError("INVALID_REQUEST", "unsupported query operation");
}
