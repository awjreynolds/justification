# Read-query TDD evidence

This note records the first bounded cycle for `context`, `search` and `trace`.
The query module will consume a validated immutable history snapshot and a
narrow assessment service supplied by the runtime. It will not import the
runtime as a value or duplicate `assessNode`; the runtime remains the owner of
support semantics and the dispatcher remains the owner of history loading.

The proposed public shapes and byte-budget rule are documented in the
[read-query section of the runtime API](runtime-api.md). The default response
budget is 32 KiB. A supplied budget counts the UTF-8 bytes of the complete
`JSON.stringify({ revision, data })` envelope, including multibyte text, and a
budget below the empty-envelope minimum must return `INVALID_REQUEST` with a
`minimumBudget` detail.

The first behavior is deliberately narrow: a public `search` call over two
real recorded claims returns only the matching claim, its compact title/body
snippet and deterministic scope metadata. The test also checks the complete
response's UTF-8 byte length against a 512-byte cap. The fixture contains the
multibyte term `café`, making the encoding explicit in the assertion. A later
near-boundary fixture will force a meaningful truncation decision where a
character-count budget would produce a different result.

The test was written against the public runtime seam with a temporary project,
fixed timestamps and independent expected values. It does not inspect history
files or call query helpers. Before query implementation, the dispatcher is
expected to reject the reserved operation; this is the meaningful RED for the
first cycle.

## First cycle: public lexical search

The deliberate RED command and observed result will be recorded here before
the production query module is added:

```sh
node --test test/queries.test.ts
```

Observed on 2026-09-10 at core revision `05f595e`:

```text
✖ search returns deterministic lexical hits within the whole-response UTF-8 byte budget
Error [RuntimeError]: unsupported runtime operation: search
    code: INVALID_REQUEST
tests 1 | pass 0 | fail 1
```

The failure reaches the public dispatcher after project initialization and
two public `record` calls, so it demonstrates the missing behavior rather than
a broken test runner or missing dependency. No query implementation has been
added after this RED; the next bounded step is the minimum GREEN implementation
for this exact search outcome.

The minimum search implementation is now GREEN. It reads the validated current
history supplied by the dispatcher, filters shared/selected-KB nodes, emits
deterministic compact lexical hits and fits the complete response envelope by
UTF-8 byte length. The focused run passed 1 test with 0 failures; typecheck,
build and `git diff --check` also passed. This is a short-budget fit check, not
the later near-boundary truncation proof.

## Second cycle: context flags and direct knowledge

The next deliberate RED added one public context scenario: an artifact is
supported by a direct claim, and that claim is supported by an explicitly
accepted assumption. The expected result excludes the artifact anchor, places
the claim before the assumption, and exposes `supported`, `assumed`,
`disputed` and `pending` independently alongside the injected support
assessment.

Running the focused file before the context hook was implemented produced:

```text
✔ search returns deterministic lexical hits within the whole-response UTF-8 byte budget
✖ context puts supported direct claim knowledge before an output anchor
Error [RuntimeError]: unsupported runtime operation: context
    code: INVALID_REQUEST
tests 2 | pass 1 | fail 1
```

This RED reaches the public dispatcher after public `record` and `justify`
operations. The minimum GREEN will implement this anchored support-context
projection through the runtime assessment callback; contradiction and lexical
query context cases remain separate cycles.

The next step after seam review is the minimum implementation that makes this
one behavior pass. Context flags, direct-claim ordering, trace paths and the
remaining truncation and scope cases follow as separate bounded cycles.

## Third cycle: inclusive upstream trace paths

The context implementation now reuses one summary builder for lexical search
and support context. Search results therefore retain their compact lexical
fields while also exposing the runtime assessment and the four orthogonal
knowledge flags. The focused file passed 2 tests with 0 failures after the
search expectation was extended to cover an unsupported claim's pending
assessment.

The next deliberate RED added one public upstream trace scenario: an artifact
has a recorded basis claim, and that claim has an explicitly justified
assumption. The expected result keeps the root separate, returns inclusive
paths for both upstream nodes, and labels each support edge as declared basis.
Before adding the trace dispatcher branch, the focused command produced:

```text
✔ search returns deterministic lexical hits within the whole-response UTF-8 byte budget
✔ context puts supported direct claim knowledge before an output anchor
✖ trace follows declared upstream support with inclusive deterministic paths
Error [RuntimeError]: unsupported runtime operation: trace
    code: INVALID_REQUEST
tests 3 | pass 2 | fail 1
```

This RED reaches the public dispatcher after public records and justification
operations. The minimum GREEN is the cycle-safe graph walk and complete
UTF-8-budgeted response projection for the trace operation.

The context and trace minimum implementations are GREEN. The focused query
file now passes all 3 tests with 0 failures, and `npm run typecheck` passes.
Context traverses the retained support tree, excludes its anchor, assesses each
visible premise once through the runtime callback, and preserves source-node
provenance. Trace walks justification, evidence-to-source and typed-link edges
in either direction with cycle-safe inclusive paths. Both operations use the
same whole-envelope UTF-8 budget fitter; the broader scope, contradiction,
near-boundary truncation and MCP checks remain package-level validation work.

## Fourth cycle: open review alongside usable support

The contract keeps review workflow independent from computed support. A claim
may retain an open review for a changed original evidence basis while an
independent accepted alternative keeps its current support assessment usable.
The query projection now has a bounded place for that state: `reviewRequired`
and sorted `openReviewIds`; these fields do not alter `flags.pending` or
`support.status`.

The deliberate RED added a public source-maintenance fixture: capture a source,
justify a claim with its evidence, add an accepted alternative justification,
record an artifact on the claim, change and refresh the source, then query the
artifact context. Before the review fields were projected, the focused command
produced:

```text
✖ search returns deterministic lexical hits within the whole-response UTF-8 byte budget
  expected reviewRequired=false and openReviewIds=[]; actual fields absent
✔ context puts supported direct claim knowledge before an output anchor
✔ trace follows declared upstream support with inclusive deterministic paths
✖ query summaries preserve open source reviews beside usable alternative support
  expected reviewRequired=true and the changed claim's open review ID; actual fields absent
tests 4 | pass 2 | fail 2
```

The search expectation failed at the same missing projection because its
returned claim is intentionally unsupported and has no open review. The
minimum GREEN will derive review IDs from durable state, apply KB visibility to
change and contradiction triggers, and include the fields in the same complete
UTF-8 budget calculation.

The review projection is now GREEN. The public fixture passes with the changed
claim still `support.status: "usable"`, `flags.pending: false` and
`flags.supported: true` through the accepted alternative, while
`reviewRequired: true` and `openReviewIds` contain exactly the durable open
review created for the changed original basis. The focused query file passes
4 tests with 0 failures; the package's existing OR-support behavior is covered
independently by the same fixture.

## Fifth cycle: near-boundary multibyte budgets

The fixed-boundary public fixture uses four searchable claims with 240 Unicode
characters alternating `é` and `🧪`, plus an artifact whose basis reaches all
four claims. With a requested budget of exactly 1,200 bytes, the current
implementation retains one large result and explicitly truncates each of
`search`, anchored `context` and upstream `trace`; each complete
`JSON.stringify(response)` envelope fits when measured with
`Buffer.byteLength(..., "utf8")`. The omitted results prove the budget is
active at a meaningful multibyte boundary rather than merely accepting a
comfortably small response.

The same public test sends `budget: 1` to all three operations and checks the
typed `QueryError` shape: `code: "INVALID_REQUEST"` plus a numeric
`details.minimumBudget`. The focused query suite was already GREEN for this
case, passing 5 tests with 0 failures, so no production correction was needed.

## Sixth cycle: scoped disputes, reviews and typed-link cycles

The second public verification fixture creates shared policy nodes, two child
KBs (`adr` and `research`), an open shared contradiction and an open `adr`
contradiction involving a shared endpoint. It creates the corresponding
artifacts through public `record`, then adds an `adr` typed-link cycle through
public `relate` calls.

The existing implementation was already GREEN before any correction:

```text
✔ scoped queries isolate child disputes and reviews while tracing typed cycles finitely
tests 1 | pass 1 | fail 0
```

The case verifies exact shared/child/sibling result IDs for search and
anchored context, `disputed` and `reviewRequired`/`openReviewIds` for the
shared and child nodes, and no sibling leakage. It verifies upstream typed-link
paths, downstream cycle termination without repeating the root, and scoped
downstream paths for shared and sibling-child reads. No production correction
was needed; the full focused query suite is now 6 tests.

The review projection is now GREEN. The public fixture passes with the changed
claim still `support.status: "usable"`, `flags.pending: false` and
`flags.supported: true` through the accepted alternative, while
`reviewRequired: true` and `openReviewIds` contain exactly the durable open
review created for the changed original basis. The focused query file passes
4 tests with 0 failures; the package's existing OR-support behavior is covered
independently by the same fixture.
