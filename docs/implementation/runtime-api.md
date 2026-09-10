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
  | { op: "contradict"; left: string; right: string; rationale: string; actor: string }
  | { op: "conflicts"; kb?: string }
  | { op: "review"; reviewId?: string; status?: "open" | "closed"; actor?: string; rationale?: string; kb?: string }
  | { op: "promote"; nodeId: string; actor: string; expectedRevision?: number; reason?: string; conflicts?: string[] }
  | { op: "resolve_conflict"; contradictionId: string; resolution: "supersession" | "different_scope" | "different_time" | "source_error" | "unresolved"; rationale: string; actor: string; expectedRevision?: number }
  | { op: "audit"; kb?: string; evaluationTime?: string }
  | { op: "rebuild"; actor?: string }
  | { op: "export"; kb?: string; outputDir?: string };
```

Mutations may include `expectedRevision` to fail closed when the caller's
read is stale. `record` accepts the eleven node kinds in `NodeKind`. Decision and artifact
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

For the primary ADR chain, mutation results use these concrete data members:

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
    "originalBasis": { "justification": { "id": "basis-id", "recordedAtRevision": 7 } },
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
