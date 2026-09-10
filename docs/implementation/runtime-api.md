# Runtime operation API

The runtime has one dispatcher, `executeOperation(root, request)`, in addition
to the existing `initializeProject(root)` and `discoverProjects(roots)`
bootstrap functions. Requests are JSON objects with an `op` discriminant. A
mutation requires `actor`; timestamps are optional and are normalized by the
runtime. Responses are JSON serializable and include `revision` for graph
operations.

```ts
type RuntimeRequest =
  | { op: "knowledge_bases"; kb?: string }
  | { op: "create_kb"; id: string; title: string; parent?: string; actor: string; expectedRevision?: number }
  | { op: "record"; kb: string; kind: NodeKind; title: string; body?: string; actor: string; basis?: string[]; basisGroups?: string[][]; fields?: object; applicability?: Applicability }
  | { op: "justify"; conclusion: string; groups: (string[] | { premises: string[] })[]; rationale: string; actor: string; kb?: string; title?: string; applicability?: Applicability }
  | { op: "relate"; from: string; to: string; type: RelationshipType; actor: string; kb?: string; rationale?: string }
  | { op: "capture_source"; locator: string; actor: string; kb?: string; title?: string; sourceId?: string }
  | { op: "inspect_source"; sourceId?: string; locator?: string; kb?: string }
  | { op: "evidence"; evidenceId?: string; sourceId?: string; kb?: string }
  | { op: "why"; nodeId: string; kb?: string; revision?: number; evaluationTime?: string }
  | { op: "impact"; nodeId: string; kb?: string; evaluationTime?: string }
  | { op: "trace"; nodeId: string; direction?: "upstream" | "downstream"; kb?: string; budget?: number }
  | { op: "refresh"; sourceIds?: string[]; kb?: string; actor: string; evaluationTime?: string }
  | { op: "changed"; sourceId?: string; kb?: string }
  | { op: "context"; nodeId?: string; query?: string; kb?: string; budget?: number; evaluationTime?: string }
  | { op: "search"; query: string; kb?: string; budget?: number }
  | { op: "contradict"; left: string; right: string; rationale: string; actor: string; kb?: string }
  | { op: "conflicts"; kb?: string }
  | { op: "review"; reviewId?: string; status?: "open" | "closed"; actor?: string; rationale?: string; kb?: string }
  | { op: "promote"; nodeId: string; actor: string; expectedRevision?: number; reason?: string; conflicts?: string[] }
  | { op: "resolve_conflict"; contradictionId: string; resolution: "supersession" | "different_scope" | "different_time" | "source_error" | "unresolved"; rationale: string; actor: string; winnerId?: string; kb?: string; expectedRevision?: number }
  | { op: "audit"; kb?: string; evaluationTime?: string }
  | { op: "rebuild"; actor?: string }
  | { op: "export"; kb?: string; outputDir?: string };
```

Mutations may include `expectedRevision` to fail closed when the caller's
read is stale. The graph has twelve node kinds in `NodeKind`; `capture_source`
creates source and evidence records, while `record` creates the other kinds. Decision and artifact
records must include a nonempty `basis` or `basisGroups`; the runtime creates
the original basis justification in the same revision and records its revision
on the node. Later `justify` calls are current alternatives and never rewrite
that original basis.

The normal response shape is `{ revision, data }`. Query data uses stable IDs
and includes `scope` where a KB was supplied. Errors are thrown as
`RuntimeError`, `ProviderError`, or `StorageError` and carry a stable `code`
and a JSON-safe `details` object. The runtime rejects unknown fields on
structured input where they would change semantics, malformed applicability
timestamps, cross-project references, out-of-scope references, support cycles,
and provider paths that escape the configured project root.

OKF export writes the current readable projection under `kb/` and reports that
the projection does not contain the complete native revision history. Native
history remains the numbered, integrity-chained snapshots in
`justification-history/`.

For a captured knowledge chain, mutation results use these concrete data members:

```json
{
  "capture_source": {
    "source": { "id": "source-id", "nodeId": "source-node-id", "locator": "constraints.md" },
    "observation": { "id": "observation-id", "observedText": "...", "providerRevision": "...", "digest": "..." },
    "evidence": { "id": "evidence-id", "sourceId": "source-id", "observationId": "observation-id" }
  },
  "record": { "node": { "id": "node-id", "kind": "claim" }, "justification": null },
  "justify": { "justification": { "id": "justification-id", "conclusion": "node-id", "groups": [{ "premises": ["evidence-id"] }] } },
  "why": {
    "node": { "id": "node-id" },
    "originalBasis": { "justification": { "id": "basis-id" }, "recordedAtRevision": 7 },
    "upstream": [{ "id": "evidence-id" }, { "id": "source-node-id" }],
    "provenance": [{ "sourceId": "source-id", "observationId": "observation-id", "observedText": "..." }]
  }
}
```

The `record` result includes the atomic basis justification for a decision or
artifact. Its node fields include `originalBasisJustificationId` and
`recordedAtRevision`; later `justify` calls appear as current alternatives in
`why` and do not replace this acceptance basis. Exported concept documents
render the original basis, readable ID links, rationale and retained source
locator in the body as well as preserving IDs in the `justification` profile.

## Source-change maintenance result shapes

Source maintenance uses the same `{ revision, data }` envelope. The arrays
below contain durable records, are scoped to the requested project and KB, and
are sorted deterministically by their IDs unless an operation says that an
array is chronological. A refresh that observes no change does not commit a
revision and returns empty `observations`, `changes` and `reviews` arrays.

`refresh` checks the selected sources and, when content or availability
changes, retains only the newly created observations and change records in its
result. `sources` contains the resulting source records for the selection;
`changed` identifies whether at least one source state changed.

```json
{
  "refresh": {
    "changed": true,
    "sources": [{ "id": "source-id", "currentObservationId": "new-observation-id" }],
    "observations": [{ "id": "new-observation-id", "sourceId": "source-id", "observedText": "...", "digest": "..." }],
    "changes": [{ "id": "change-id", "sourceId": "source-id", "beforeObservationId": "old-observation-id", "afterObservationId": "new-observation-id", "reason": "content_changed" }],
    "reviews": [{ "id": "review-id", "nodeId": "claim-id", "triggerType": "change", "triggerId": "change-id", "status": "open" }]
  }
}
```

`impact` starts at the requested node and returns every conservative
downstream dependent. Each `paths` entry is an inclusive node-ID path from the
requested node to the affected node. `reasons` contains one or more
human-readable explanations for why that path is affected. When the requested
node is a source, every retained evidence node for that source is included,
including historical and newly captured observations; only the prior evidence
and its downstream dependents receive change reviews. The expected chain is
therefore `source → evidence → claim → decision → artifact`.

```json
{
  "impact": {
    "node": { "id": "source-node-id", "kind": "source" },
    "affected": [
      { "node": { "id": "old-evidence-id" }, "paths": [["source-node-id", "old-evidence-id"]], "reasons": ["source observation changed"] },
      { "node": { "id": "new-evidence-id" }, "paths": [["source-node-id", "new-evidence-id"]], "reasons": ["source observation retained"] },
      { "node": { "id": "claim-id" }, "paths": [["source-node-id", "old-evidence-id", "claim-id"]], "reasons": ["support depends on changed evidence"] },
      { "node": { "id": "decision-id" }, "paths": [["source-node-id", "old-evidence-id", "claim-id", "decision-id"]], "reasons": ["basis depends on changed claim"] },
      { "node": { "id": "artifact-id" }, "paths": [["source-node-id", "old-evidence-id", "claim-id", "decision-id", "artifact-id"]], "reasons": ["basis depends on changed decision"] }
    ],
    "changes": [{ "id": "change-id", "sourceId": "source-id" }],
    "reviews": [{ "id": "review-id", "nodeId": "claim-id", "triggerId": "change-id", "status": "open" }]
  }
}
```

Source and evidence inspection expose the durable provenance needed to
reproduce a change. `inspect_source` returns the selected `source`, all of its
chronological `observations`, linked `evidence` nodes and its `changes`.
`evidence` has the same arrays and accepts either `evidenceId` or `sourceId`.
`changed` returns the selected `sources`, chronological `observations` and
recorded `changes`; it does not read a transient cache.

```json
{
  "inspect_source": {
    "source": { "id": "source-id", "currentObservationId": "new-observation-id" },
    "observations": [{ "id": "old-observation-id" }, { "id": "new-observation-id" }],
    "evidence": [{ "id": "old-evidence-id" }, { "id": "new-evidence-id" }],
    "changes": [{ "id": "change-id", "beforeObservationId": "old-observation-id", "afterObservationId": "new-observation-id" }]
  },
  "evidence": {
    "source": { "id": "source-id" },
    "observations": [{ "id": "old-observation-id" }, { "id": "new-observation-id" }],
    "evidence": [{ "id": "old-evidence-id" }, { "id": "new-evidence-id" }],
    "changes": [{ "id": "change-id" }]
  },
  "changed": {
    "sources": [{ "id": "source-id" }],
    "observations": [{ "id": "old-observation-id" }, { "id": "new-observation-id" }],
    "changes": [{ "id": "change-id" }]
  }
}
```

`review` without a `reviewId` lists review records in the selected scope:
`data` is `{ "reviews": ReviewRecord[], "changes": ChangeRecord[] }`.
The `why` response retains its historical explanation fields and adds
`reviews`, `changes`, `evidence` and `observations` arrays for the current
scope. A source change makes the retained old evidence pending in a current
`why` assessment while its open reviews remain independently visible. A
historical `why` at the committed pre-change revision reads only that revision
and remains byte-for-byte equivalent to the earlier response.

The initial file provider hashes the exact captured UTF-8 bytes with SHA-256.
An observation exposes that digest as `observedBytesDigest`, uses the same
content address as its `digest` for text, and records
`providerRevision: "sha256:<hex>"`. Filesystem mtime/size may be used as a
transient pre-read stability check but never replace this durable revision.

## Contradictions, review closure and typed relationships

`contradict` creates an attributed open record with `kb`, `left`, `right` and
`rationale`. The owning scope may name an inherited shared endpoint; child
conflict records and their review work remain private to that child. The
`conflicts` read returns visible records in both `conflicts` and
`contradictions` fields for transport compatibility. `resolve_conflict`
appends an attributed `{ resolution, actor, at, rationale }` entry to
`resolutionHistory`; `supersession` additionally requires `winnerId` to equal
one endpoint. It sets the record to `resolved`, while `unresolved` records the
attempt and leaves it `open`. Resolution never changes node content or
declared support. Contradiction and review records are rendered only in the
owning node's extension, so shared and sibling projections do not expose a
child-owned conflict.

`review` with only `status` and/or `kb` lists visible records. Its mutation form
requires `reviewId`, `status: "closed"`, a nonempty actor and rationale, and
returns the closed record with `closedBy`, `closedAt`, `closureRationale` and a
typed `closureHistory` entry. Repeating the same closure at the current
expected revision is a no-op response with `committed: false` and
`idempotent: true`; a later source change creates a distinct open review.

`relate` creates an attributed typed relationship owned by its `from` node's
KB. The target may be inherited shared knowledge, but a sibling child target
is rejected. Ordinary typed relationships may cycle; `trace` uses visited
paths to terminate and scoped traces omit child-owned edges.

## Read-query result shapes

The read-only `search`, `context` and `trace` operations use the same
`{ revision, data }` envelope. Their result entries are compact summaries so a
caller can enforce a byte budget without receiving an unbounded Markdown body.
The summary shape is:

```ts
type QueryNode = {
  id: string;
  kb: string;
  kind: NodeKind;
  title: string;
  snippet: string;
};

type QueryResult = QueryNode & {
  flags: {
    supported: boolean;
    assumed: boolean;
    disputed: boolean;
    pending: boolean;
  };
  support: {
    status: "usable" | "pending" | "unusable";
    reason: string;
  };
  reviewRequired: boolean;
  openReviewIds: string[];
};

type QueryScope = { kb: string | null };
```

`snippet` is the node body after whitespace collapse, falling back to the title
when the body is empty, and is capped at 240 characters. It is a lexical
excerpt, never an inferred or paraphrased claim. Search
normalizes the trimmed query and node text to NFC and lower case, requires all
nonempty query terms to occur in the title or body, and orders matches by total
term occurrence count descending, then title and ID in deterministic lexical
order. Source, evidence and all other visible node kinds are searchable. Both
`search` and `context` add the same runtime support assessment and orthogonal
knowledge flags to every returned result.

`search` returns:

```json
{
  "query": "café",
  "scope": { "kb": "shared" },
  "results": [
    {
      "id": "node-id",
      "kb": "shared",
      "kind": "claim",
      "title": "Café pilot",
      "snippet": "The café pilot favors a weekly digest.",
      "flags": {
        "supported": false,
        "assumed": false,
        "disputed": false,
        "pending": true
      },
      "support": {
        "status": "pending",
        "reason": "no declared support basis"
      },
      "reviewRequired": false,
      "openReviewIds": []
    }
  ],
  "truncated": false
}
```

`context` returns relevant knowledge in a scope. With `nodeId`, the anchor's
declared support and source provenance are eligible; with `query`, lexical
matching selects eligible nodes. Direct claim, assumption, requirement,
question and option knowledge is ordered before decisions, actions and
artifacts so an output can reuse knowledge without inventing a decision. When
`nodeId` is supplied, the anchor itself is omitted from `results`; the returned
entries are the visible knowledge that explains or contextualizes it. Every
entry carries orthogonal flags and the existing support assessment:

```json
{
  "scope": { "kb": "research" },
  "anchor": { "id": "artifact-id", "kind": "artifact" },
  "results": [
    {
      "id": "claim-id",
      "kb": "research",
      "kind": "claim",
      "title": "Retained finding",
      "snippet": "The retained finding...",
      "flags": {
        "supported": true,
        "assumed": false,
        "disputed": false,
        "pending": false
      },
      "support": {
        "status": "usable",
        "reason": "declared basis is usable"
      },
      "reviewRequired": false,
      "openReviewIds": []
    }
  ],
  "truncated": false
}
```

`supported` means that a declared basis is currently usable according to the
runtime checks. `assumed` identifies an explicit assumption node, `disputed`
identifies participation in an open contradiction, and `pending` reflects a
pending support assessment. These flags can coexist; none asserts semantic
truth. A node with no usable declared support remains visible with its support
status and reason. `reviewRequired` and `openReviewIds` report currently open
review work for that node independently of support; a usable alternative can
therefore coexist with an open review for a changed original basis. Review IDs
are sorted deterministically and are filtered to the requested KB's visible
change or contradiction trigger.

`trace` follows the declared graph from one visible node. `direction` defaults
to `upstream`; `upstream` follows justification and decision/artifact basis
premises, retained evidence to its source node, and the target of a typed
relationship. `downstream` follows those edges in reverse. It is cycle-safe
and includes typed-link reasons as well as declared support and source
provenance; it does not infer edges from prose.

```json
{
  "scope": { "kb": "research" },
  "root": { "id": "artifact-id", "kb": "research", "kind": "artifact", "title": "Research brief" },
  "direction": "upstream",
  "results": [
    {
      "id": "claim-id",
      "kb": "research",
      "kind": "claim",
      "title": "Retained finding",
      "snippet": "The retained finding...",
      "paths": [["artifact-id", "claim-id", "evidence-id", "source-node-id"]],
      "reasons": ["declared basis", "source provenance"]
    }
  ],
  "truncated": false
}
```

The `paths` arrays are inclusive ID paths from the root to each result. An
entry may have multiple paths and deduplicated reasons. Results never expose a
sibling KB when `kb` selects a child; shared nodes remain visible through the
requested child scope, while child-owned nodes, reviews and contradictions
remain private to that child.

All three operations accept an optional positive integer `budget`. It is the
maximum number of UTF-8 bytes in `JSON.stringify({ revision, data })`, including
the envelope, query text, summaries, paths and the `truncated` flag. An omitted
budget defaults to 32 KiB. Results are added in deterministic order until the
complete envelope would exceed the cap; the operation then returns the fitting
prefix with `truncated: true`. If even the empty result envelope cannot fit,
the operation fails with `INVALID_REQUEST` and reports the calculated
`minimumBudget` in its error details. A budget is therefore a real response
bound, not a token or character hint; callers should measure the returned
envelope with `Buffer.byteLength(JSON.stringify(response), "utf8")`.

## Audit result

`audit` is a read-only diagnostic over the current validated revision. It
returns the normal `{ revision, data }` envelope and never refreshes a source,
closes a review, rewrites an artifact or commits a semantic revision. The
optional `kb` selects shared knowledge plus that child knowledge base; sibling
nodes, reviews and contradictions are excluded. `evaluationTime` defaults to
the current revision's commit time and is returned as an offset-normalized ISO
timestamp.

```ts
type AuditCategory =
  | "unsupported"
  | "missing_provenance"
  | "source_freshness"
  | "open_review"
  | "artifact_drift"
  | "open_contradiction";

type AuditFinding = {
  category: AuditCategory;
  nodeId?: string;
  kind?: NodeKind;
  sourceId?: string;
  reviewId?: string;
  contradictionId?: string;
  locator?: string;
  status?: string;
  reason: string;
};

type AuditData = {
  scope: { kb: string | null };
  evaluationTime: string;
  findings: readonly AuditFinding[];
};
```

An `unsupported` finding identifies a decision or artifact whose declared
bases are not currently usable according to the runtime support assessment.
`missing_provenance` identifies a claim or assertion without a declared path
to retained source evidence. `source_freshness` identifies a source whose
retained evidence no longer matches its current provider observation.
`open_review` carries the affected node and review ID for each visible open
review. `open_contradiction` carries the visible contradiction ID and remains
independent of support or freshness. A finding's `reason` is diagnostic text;
it does not assert that a proposition is false.

For an artifact with `fields.locator` and a recorded digest, `artifact_drift`
is emitted when the project-relative `FileKnowledgeProvider` observes changed,
missing or unavailable bytes. Provider containment and size/UTF-8 limits still
apply. The audit reports the observed condition and leaves the file and
semantic state unchanged. Findings are deterministic for a validated revision
and sorted by category and subject identifiers.

## Artifact maintenance

An unqualified or KB-scoped `refresh` checks visible artifact files as well as
sources. Explicit `sourceIds` restricts the operation to sources. Artifact
checks use the same contained UTF-8 file provider as source capture.

The response adds an `artifactDrifts` array. Each transition contains `id`,
`artifactId`, `locator`, `before`, `after`, `reason`, `createdBy` and `createdAt`.
File states contain `status` and, when present, `digest` and `bytesDigest`;
unavailable states may include `diagnostics`. Reasons are `content_changed`
or `availability_changed`.

Source and artifact transitions commit together under the same expected
revision check. A file state different from the accepted artifact opens an
`artifact_drift` review linked by `triggerId` to its transition. Repeating the
same state commits nothing. Restoration to accepted bytes is retained without
opening a new review, so a later recurrence of the old drift is still a new
event. Old reviews retain their status until explicitly closed. Neither refresh
nor audit rewrites the file or replaces its accepted digest.

## Promotion

`promote` accepts `nodeId`, `actor`, optional `reason`, optional `conflicts`
and the common timestamp/revision fields. It preserves the node's identity,
content, creation attribution and historical explanations while moving its
current scope to `shared`. Its support premises, outgoing relationship targets,
recorded option references and source provenance must already be shared.
Promote a source before its retained evidence. A rejected dependency reports
`SCOPE_VIOLATION` with its identifier and kind.

A successful response has `promoted: true`, `committed: true`, the updated
`node`, moved `justifications` and `relationships`, and an attributed
`scopeChange` containing `id`, `nodeId`, `from`, `to`, optional `reason`,
`createdBy` and `createdAt`. The generated document moves to the shared
directory; validated history identifies the obsolete generated child file,
including after disposable cache loss. Unrelated human files are preserved.

An open child contradiction involving the candidate requires
`resolve_conflict` before promotion. Conflicts supplied by ID, or differing
bodies under the same `fields.propositionKey` in shared knowledge, create
durable `promotion_conflict` reviews and return `promoted: false` with
`scopeChange: null`. The child remains unchanged. Inspect and close that review
with an actor and rationale, then retry. Repeated pending attempts preserve the
same review instead of creating duplicate work, even if `conflicts` is omitted
from the later request. Resolving a contradiction and
closing a promotion review are separate explicit actions.

Child-owned conflicts and promotion reviews retain their ownership after a
successful move. Their history remains readable in the child's index and is
excluded from shared and sibling review surfaces and generated documents.
