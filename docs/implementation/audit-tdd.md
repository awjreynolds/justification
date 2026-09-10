# Audit TDD evidence

The audit operation is a read-only diagnostic over one validated semantic
revision. It does not close reviews, refresh sources, repair artifacts or
commit a revision. Its support status comes from the runtime's existing
`assessNode` callback; the audit module does not implement a second support
evaluator. Artifact checks use the project-relative `FileKnowledgeProvider`
and report provider failures rather than rewriting the output.

## First cycle: scoped audit report

The first public fixture uses real temporary project files and public runtime
operations. It creates shared source-backed support for a claim, decision and
artifact, plus an ungrounded claim and decision. It creates local and sibling
assertions without provenance, changes the source and refreshes it to create
open reviews, then edits the recorded artifact file. The audit is requested in
the local child scope.

The expected diagnostic categories are independently defined by the fixture:

| Category | Expected subject | Why it is present |
| --- | --- | --- |
| `unsupported` | the source-backed decision ID, explicit ungrounded decision ID and artifact ID | the source-backed decision and artifact are pending after the source change; the ungrounded decision has no usable basis |
| `missing_provenance` | the ungrounded shared claim ID and local assertion ID | neither has a declared provenance path to retained source evidence |
| `source_freshness` | the captured shared source ID | its retained old evidence no longer matches the current source observation |
| `open_review` | the four open reviews returned by the source refresh | the old evidence, supported claim, decision and artifact require reassessment |
| `artifact_drift` | the explicit artifact ID | the file at its recorded locator no longer has its recorded digest |

The sibling assertion is deliberately absent from the expected local-scope
result. Shared nodes and their visible reviews remain available to the child;
sibling-owned nodes and trigger details remain excluded. The expected audit
response keeps the refresh revision unchanged and returns an ISO-normalized
evaluation time.

The response contract used by this slice is:

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

The deliberate RED run used the pinned Node 24.21.0 source-runtime path after
the normal build was blocked by an unrelated concurrent query-worker type
error (`summarizeNode` does not yet provide the newly required
`reviewRequired` and `openReviewIds` fields):

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  node --test test/audit.test.ts
```

All fixture setup operations reached the public audit call. The test then
failed because the dispatcher still reports audit as unsupported:

```text
1 test, 1 failure
Error [RuntimeError]: unsupported runtime operation: audit
code: INVALID_REQUEST
test/audit.test.ts:163
```

This is a meaningful RED: the fixture exercises real source capture, support,
refresh-generated reviews, child scope and changed artifact bytes before the
read-only audit boundary. No `src/audit.ts` implementation or runtime audit
dispatch hook has been added after this run.

The minimum GREEN implementation adds a read-only `executeAudit` module. It
reuses the runtime's support assessment and scope helpers, walks only visible
nodes, probes sources and artifact locators through `FileKnowledgeProvider`,
and sorts findings deterministically. Provider failures become diagnostic
findings; the audit does not write files or append history. The corrected
independently expected unsupported set is the source-backed decision,
ungrounded decision and artifact (`decisionId`, `unsupportedDecisionId`,
`artifactId`), because all three are non-usable after the source change.

The first focused GREEN run passed the original public behavior (`1 test, 1
pass, 0 failures`). The follow-up public checks then passed:

- A child-owned contradiction over an inherited shared option appears in the
  child audit with its open review, while shared audit output excludes both
  the child contradiction and child review.
- Removing one recorded artifact and replacing another with invalid UTF-8
  produces `artifact_drift` findings with `missing` and `unavailable` statuses,
  provider diagnostics, unchanged file bytes and the same semantic revision.

The final focused run passed all three audit behaviors (`3 tests, 3 passes, 0
failures`). The pinned Node 24.21.0 typecheck and package build also passed:

```text
npm run typecheck: passed
npm run build: passed
```
