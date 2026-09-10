import { createHash } from "node:crypto";

export const HISTORY_FORMAT = "justification.history" as const;
export const HISTORY_VERSION = 1 as const;
export const STATE_FORMAT = "justification.state" as const;
export const STATE_VERSION = 1 as const;
export const JUSTIFICATION_PROFILE = "justification/1" as const;

export const NODE_KINDS = [
  "source",
  "evidence",
  "claim",
  "assumption",
  "requirement",
  "question",
  "option",
  "decision",
  "action",
  "artifact",
  "assertion"
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export type Applicability = {
  readonly subject?: string;
  readonly version?: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
};

export type Attribution = {
  readonly createdBy: string;
  readonly createdAt: string;
};

export type NodeFields = {
  readonly propositionKey?: string;
  readonly accepted?: boolean;
  readonly locator?: string;
  readonly digest?: string;
  readonly consideredOptions?: readonly string[];
  readonly selectedOption?: string;
  readonly rationale?: string;
  readonly basis?: readonly string[];
  readonly basisGroups?: readonly (readonly string[])[];
  readonly recordedAtRevision?: number;
  readonly originalBasisJustificationId?: string;
  readonly sourceId?: string;
  readonly observationId?: string;
  readonly providerId?: string;
  readonly providerRevision?: string;
  readonly observedText?: string;
  readonly observedBytesDigest?: string;
  readonly availability?: SourceAvailability;
  readonly [key: string]: unknown;
};

export type NodeRecord = Attribution & {
  readonly id: string;
  readonly kb: string;
  readonly kind: NodeKind;
  readonly title: string;
  readonly body: string;
  readonly applicability?: Applicability;
  readonly fields?: NodeFields;
};

export type KnowledgeBaseRecord = Attribution & {
  readonly id: string;
  readonly title: string;
  readonly parent: string | null;
};

export type SourceAvailability = "present" | "missing" | "unavailable" | "denied";

export type SourceRecord = Attribution & {
  readonly id: string;
  readonly nodeId: string;
  readonly kb: string;
  readonly providerId: string;
  readonly locator: string;
  readonly selector?: string;
  readonly currentObservationId?: string;
  readonly availability: SourceAvailability;
  readonly providerRevision?: string;
  readonly currentDigest?: string;
};

export type SourceObservation = Attribution & {
  readonly id: string;
  readonly sourceId: string;
  readonly providerId: string;
  readonly locator: string;
  readonly providerRevision?: string;
  readonly digest?: string;
  readonly observedText?: string;
  readonly observedBytesDigest?: string;
  readonly availability: SourceAvailability;
  readonly diagnostics?: string;
  readonly contentType?: string;
};

export type PremiseGroup = {
  readonly id: string;
  readonly premises: readonly string[];
};

export type JustificationRecord = Attribution & {
  readonly id: string;
  readonly kb: string;
  readonly conclusion: string;
  readonly groups: readonly PremiseGroup[];
  readonly rationale: string;
  readonly title?: string;
  readonly applicability?: Applicability;
};

export type RelationshipType =
  | "depends_on"
  | "references"
  | "produces"
  | "derived_from"
  | "relevant_to"
  | "supports"
  | "contradicts"
  | "refines";

export const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  "depends_on",
  "references",
  "produces",
  "derived_from",
  "relevant_to",
  "supports",
  "contradicts",
  "refines"
];

export type RelationshipRecord = Attribution & {
  readonly id: string;
  readonly kb: string;
  readonly from: string;
  readonly to: string;
  readonly type: RelationshipType;
  readonly rationale?: string;
};

export type ChangeRecord = Attribution & {
  readonly id: string;
  readonly sourceId: string;
  readonly beforeObservationId?: string;
  readonly afterObservationId?: string;
  readonly beforeDigest?: string;
  readonly afterDigest?: string;
  readonly beforeAvailability: SourceAvailability;
  readonly afterAvailability: SourceAvailability;
  readonly reason: "content_changed" | "availability_changed";
};

export type ArtifactFileState = {
  readonly status: SourceAvailability;
  readonly digest?: string;
  readonly bytesDigest?: string;
  readonly diagnostics?: string;
};

export type ArtifactDriftRecord = Attribution & {
  readonly id: string;
  readonly artifactId: string;
  readonly locator: string;
  readonly before: ArtifactFileState;
  readonly after: ArtifactFileState;
  readonly reason: "content_changed" | "availability_changed";
};

export type ReviewStatus = "open" | "closed";

export type ReviewClosure = {
  readonly status: "closed";
  readonly actor: string;
  readonly at: string;
  readonly rationale: string;
};

export type ReviewRecord = Attribution & {
  readonly id: string;
  readonly nodeId: string;
  /** Scope that owns review work when the affected node later changes scope. */
  readonly kb?: string;
  readonly triggerType: "change" | "contradiction" | "artifact_drift" | "promotion_conflict";
  readonly triggerId: string;
  readonly reason: string;
  readonly status: ReviewStatus;
  readonly closedBy?: string;
  readonly closedAt?: string;
  readonly closureRationale?: string;
  readonly closureHistory?: readonly ReviewClosure[];
};

export type ContradictionResolution =
  | "supersession"
  | "different_scope"
  | "different_time"
  | "source_error"
  | "unresolved";

export type ContradictionRecord = Attribution & {
  readonly id: string;
  readonly kb: string;
  readonly left: string;
  readonly right: string;
  readonly rationale: string;
  readonly status: "open" | "resolved";
  readonly resolution?: ContradictionResolution;
  readonly winnerId?: string;
  readonly resolvedBy?: string;
  readonly resolvedAt?: string;
  readonly resolutionRationale?: string;
  readonly resolutionHistory?: readonly {
    readonly resolution: ContradictionResolution;
    readonly winnerId?: string;
    readonly actor: string;
    readonly at: string;
    readonly rationale: string;
  }[];
};

export type ScopeChange = Attribution & {
  readonly id: string;
  readonly nodeId: string;
  readonly from: string;
  readonly to: string;
  readonly reason?: string;
};

export type ProjectState = {
  readonly format: typeof STATE_FORMAT;
  readonly version: typeof STATE_VERSION;
  readonly projectId: string;
  readonly projectName: string;
  readonly kbs: Readonly<Record<string, KnowledgeBaseRecord>>;
  readonly nodes: Readonly<Record<string, NodeRecord>>;
  readonly sources: Readonly<Record<string, SourceRecord>>;
  readonly observations: Readonly<Record<string, SourceObservation>>;
  readonly justifications: Readonly<Record<string, JustificationRecord>>;
  readonly relationships: Readonly<Record<string, RelationshipRecord>>;
  readonly changes: readonly ChangeRecord[];
  /** Optional so histories written before artifact drift tracking remain readable. */
  readonly artifactDrifts?: readonly ArtifactDriftRecord[];
  readonly contradictions: readonly ContradictionRecord[];
  readonly reviews: readonly ReviewRecord[];
  readonly scopeChanges: readonly ScopeChange[];
};

export type HistoryRevision = {
  readonly format: typeof HISTORY_FORMAT;
  readonly version: typeof HISTORY_VERSION;
  readonly revision: number;
  readonly previousRevision: number | null;
  readonly previousDigest: string | null;
  readonly actor: string;
  readonly action: string;
  readonly committedAt: string;
  readonly state: ProjectState;
  readonly integrity: string;
};

export function emptyState(projectId: string, projectName: string, actor = "system", at = new Date().toISOString()): ProjectState {
  const shared: KnowledgeBaseRecord = {
    id: "shared",
    title: "Shared knowledge",
    parent: null,
    createdBy: actor,
    createdAt: at
  };
  return {
    format: STATE_FORMAT,
    version: STATE_VERSION,
    projectId,
    projectName,
    kbs: { shared },
    nodes: {},
    sources: {},
    observations: {},
    justifications: {},
    relationships: {},
    changes: [],
    artifactDrifts: [],
    contradictions: [],
    reviews: [],
    scopeChanges: []
  };
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    throw new Error(`${field} must be an offset-bearing ISO timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid ISO timestamp`);
  return new Date(parsed).toISOString();
}

export function validateApplicability(value: unknown, field = "applicability"): Applicability | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  const candidate = value as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (!["subject", "version", "validFrom", "validUntil"].includes(key)) throw new Error(`${field}.${key} is unsupported`);
    if (candidate[key] !== undefined && typeof candidate[key] !== "string") throw new Error(`${field}.${key} must be a string`);
  }
  const result: Applicability = {
    ...(candidate.subject === undefined ? {} : { subject: candidate.subject as string }),
    ...(candidate.version === undefined ? {} : { version: candidate.version as string }),
    ...(candidate.validFrom === undefined ? {} : { validFrom: parseInstant(candidate.validFrom, `${field}.validFrom`) }),
    ...(candidate.validUntil === undefined ? {} : { validUntil: parseInstant(candidate.validUntil, `${field}.validUntil`) })
  };
  if (result.validFrom && result.validUntil && Date.parse(result.validFrom) >= Date.parse(result.validUntil)) {
    throw new Error(`${field}.validFrom must be before validUntil`);
  }
  return result;
}
