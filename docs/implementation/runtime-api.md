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
