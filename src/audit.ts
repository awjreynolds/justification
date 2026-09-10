import { parseInstant } from "./domain.ts";
import type {
  ContradictionRecord,
  HistoryRevision,
  NodeKind,
  NodeRecord,
  ProjectState,
  ReviewRecord,
  SourceAvailability,
  SourceObservation,
  SourceRecord
} from "./domain.ts";
import { FileKnowledgeProvider, ProviderError } from "./provider.ts";
import type { ProviderFetch } from "./provider.ts";
import { buildSupportTree, supportProvenance } from "./support-tree.ts";

export type AuditCategory =
  | "unsupported"
  | "missing_provenance"
  | "source_freshness"
  | "open_review"
  | "artifact_drift"
  | "open_contradiction";

export type AuditFinding = {
  readonly category: AuditCategory;
  readonly nodeId?: string;
  readonly kind?: NodeKind;
  readonly sourceId?: string;
  readonly reviewId?: string;
  readonly contradictionId?: string;
  readonly locator?: string;
  readonly status?: string;
  readonly reason: string;
};

export type AuditData = {
  readonly scope: { readonly kb: string | null };
  readonly evaluationTime: string;
  readonly findings: readonly AuditFinding[];
};

export type AuditRequest = {
  readonly kb?: string;
  readonly evaluationTime?: string;
};

export type AuditAssessment = {
  readonly status: "usable" | "pending" | "unusable";
  readonly reason: string;
};

export type AuditServices = {
  readonly assessNode: (state: ProjectState, nodeId: string, evaluationTime: string) => AuditAssessment;
  readonly scopedReviews: (state: ProjectState, kb?: string) => readonly ReviewRecord[];
  readonly visibleContradictions: (state: ProjectState, kb?: string) => readonly ContradictionRecord[];
};

function visibleInScope(node: NodeRecord, kb: string | undefined): boolean {
  return kb === undefined || node.kb === "shared" || node.kb === kb;
}

function sourceVisibleInScope(source: SourceRecord, kb: string | undefined): boolean {
  return kb === undefined || source.kb === "shared" || source.kb === kb;
}

function observationMatchesSource(source: SourceRecord, observation: SourceObservation | undefined): boolean {
  return observation !== undefined &&
    source.availability === "present" &&
    observation.availability === "present" &&
    source.currentDigest === observation.digest &&
    source.providerRevision === observation.providerRevision;
}

function sourceMatchesFetch(source: SourceRecord, fetched: ProviderFetch): boolean {
  if (source.availability !== fetched.status) return false;
  return fetched.status !== "present" ||
    (source.currentDigest === fetched.digest && source.providerRevision === fetched.providerRevision);
}

function deniedCause(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { readonly code?: unknown }).code;
    if (code === "EACCES" || code === "EPERM") return true;
    current = (current as { readonly cause?: unknown }).cause;
  }
  return false;
}

function providerFailure(error: unknown, locator: string): ProviderFetch {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: deniedCause(error) ? "denied" : "unavailable",
    locator,
    diagnostics: message
  };
}

async function fetchFile(provider: FileKnowledgeProvider, locator: string): Promise<ProviderFetch> {
  try {
    const resolved = await provider.resolve(locator);
    return await provider.fetch(resolved);
  } catch (error) {
    if (error instanceof ProviderError) return providerFailure(error, locator);
    throw error;
  }
}

function subjectId(finding: AuditFinding): string {
  return finding.nodeId ?? finding.sourceId ?? finding.reviewId ?? finding.contradictionId ?? finding.locator ?? "";
}

function sortFindings(findings: readonly AuditFinding[]): AuditFinding[] {
  return [...findings].sort((left, right) =>
    left.category.localeCompare(right.category) ||
    subjectId(left).localeCompare(subjectId(right)) ||
    (left.reviewId ?? "").localeCompare(right.reviewId ?? "") ||
    (left.sourceId ?? "").localeCompare(right.sourceId ?? "") ||
    (left.contradictionId ?? "").localeCompare(right.contradictionId ?? "")
  );
}

function staleEvidenceForSource(state: ProjectState, source: SourceRecord, kb: string | undefined): boolean {
  return Object.values(state.nodes).some((node) => {
    if (node.kind !== "evidence" || !visibleInScope(node, kb) || node.fields?.sourceId !== source.id) return false;
    const observationId = node.fields?.observationId;
    const observation = typeof observationId === "string" ? state.observations[observationId] : undefined;
    return !observationMatchesSource(source, observation);
  });
}

function sourceFinding(source: SourceRecord, fetched: ProviderFetch, staleEvidence: boolean): AuditFinding {
  const reason = staleEvidence
    ? `retained evidence for source ${source.id} does not match its current provider observation`
    : `current provider observation for source ${source.id} differs from retained source state`;
  return {
    category: "source_freshness",
    sourceId: source.id,
    locator: source.locator,
    status: fetched.status,
    reason
  };
}

function artifactFinding(node: NodeRecord, locator: string, fetched: ProviderFetch, reason: string): AuditFinding {
  return {
    category: "artifact_drift",
    nodeId: node.id,
    kind: node.kind,
    locator,
    ...(fetched.status === undefined ? {} : { status: fetched.status }),
    reason
  };
}

async function artifactDrift(root: string, node: NodeRecord): Promise<AuditFinding | undefined> {
  const locator = node.fields?.locator;
  const recordedDigest = node.fields?.digest;
  const recordedBytesDigest = node.fields?.observedBytesDigest;
  if (typeof locator !== "string" || locator.trim().length === 0 || typeof recordedDigest !== "string") return undefined;

  const fetched = await fetchFile(new FileKnowledgeProvider(root), locator);
  if (fetched.status !== "present") {
    return artifactFinding(
      node,
      locator,
      fetched,
      fetched.diagnostics === undefined
        ? `artifact file is ${fetched.status}`
        : `artifact file is ${fetched.status}: ${fetched.diagnostics}`
    );
  }
  if (fetched.digest !== recordedDigest || (typeof recordedBytesDigest === "string" && fetched.bytesDigest !== recordedBytesDigest)) {
    return artifactFinding(node, locator, fetched, "artifact bytes differ from the recorded digest");
  }
  return undefined;
}

/** Run a read-only audit over one validated semantic revision. */
export async function executeAudit(
  root: string,
  revision: HistoryRevision,
  request: AuditRequest,
  services: AuditServices
): Promise<AuditData> {
  const evaluationTime = parseInstant(request.evaluationTime ?? revision.committedAt, "evaluationTime");
  const state = revision.state;
  const findings: AuditFinding[] = [];

  // Calling both scope helpers also validates a requested KB through the
  // runtime's existing visibility rules before any diagnostics are returned.
  const reviews = services.scopedReviews(state, request.kb);
  const contradictions = services.visibleContradictions(state, request.kb);
  const visibleNodes = Object.values(state.nodes)
    .filter((node) => visibleInScope(node, request.kb))
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const node of visibleNodes) {
    if (node.kind === "decision" || node.kind === "artifact") {
      const assessment = services.assessNode(state, node.id, evaluationTime);
      if (assessment.status !== "usable") {
        findings.push({
          category: "unsupported",
          nodeId: node.id,
          kind: node.kind,
          status: assessment.status,
          reason: assessment.reason
        });
      }
    }
    if (node.kind === "claim" || node.kind === "assertion") {
      const support = buildSupportTree(state, node.id);
      if (supportProvenance(support).length === 0) {
        findings.push({
          category: "missing_provenance",
          nodeId: node.id,
          kind: node.kind,
          reason: "no declared support path reaches retained source evidence"
        });
      }
    }
  }

  const provider = new FileKnowledgeProvider(root);
  const sources = Object.values(state.sources)
    .filter((source) => sourceVisibleInScope(source, request.kb))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const source of sources) {
    const fetched = await fetchFile(provider, source.locator);
    const staleEvidence = staleEvidenceForSource(state, source, request.kb);
    if (staleEvidence || !sourceMatchesFetch(source, fetched)) findings.push(sourceFinding(source, fetched, staleEvidence));
  }

  for (const review of reviews) {
    if (review.status !== "open") continue;
    findings.push({
      category: "open_review",
      nodeId: review.nodeId,
      reviewId: review.id,
      status: review.status,
      reason: review.reason
    });
  }

  for (const contradiction of contradictions) {
    if (contradiction.status !== "open") continue;
    findings.push({
      category: "open_contradiction",
      contradictionId: contradiction.id,
      status: contradiction.status,
      reason: contradiction.rationale
    });
  }

  for (const node of visibleNodes) {
    if (node.kind !== "artifact") continue;
    const finding = await artifactDrift(root, node);
    if (finding !== undefined) findings.push(finding);
  }

  return {
    scope: { kb: request.kb ?? null },
    evaluationTime,
    findings: sortFindings(findings)
  };
}

