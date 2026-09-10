# Runtime TDD evidence

This note records the bounded runtime cycles completed by the implementation
agent. The domain, storage, provider and serializer foundations were written
before the first runtime behavior was exercised; they are foundation code and
are not retroactively claimed as TDD evidence. The public behavior tests use
temporary real project directories and the file-backed history implementation.

## Cycle 1: shared knowledge base discovery

Behavior: after `initializeProject(root)`, a public `knowledge_bases` operation
reports the shared knowledge base.

The deliberate red run used the public test before dispatch was implemented:

```text
Error [RuntimeError]: runtime operation is not implemented
code: INVALID_REQUEST
```

The smallest green implementation loads or creates durable revision `0`,
validates the optional scope, and returns the persisted project and shared KB
descriptor. The focused run passed the existing 13 bootstrap tests and this
behavior test (`14 passed, 0 failed` in the selected run).

## Cycle 2: child knowledge base creation and persistence

Behavior: `create_kb` creates a named child inheriting `shared`, commits one
history revision, and makes it visible to a later `knowledge_bases` call after
the same runtime is reopened.

The test was first run against the dispatcher's deliberate unsupported-operation
path and failed with the existing `INVALID_REQUEST` / `runtime operation is not
implemented` error. The minimum green implementation added validated child IDs,
parent lookup, safe `kb/<id>` directory creation, an append-only revision `1`,
expected-revision checking, and listing of the new child plus inherited shared
knowledge. The focused run passed all 15 tests (`15 passed, 0 failed`).

## Foundation corrections and export

These cycles followed review of the first two slices.

| Behavior | Red result | Green result |
| --- | --- | --- |
| A pre-existing `justification-history` symlink must not redirect writes outside the project | `knowledge_bases` unexpectedly succeeded and wrote revision 0 through the symlink; the focused test reported `Missing expected rejection` | `StorageError(HISTORY_CORRUPT)` after `lstat` rejects a history-directory symlink; revision files and lock entries receive the same guard |
| `export` emits a readable OKF projection and preserves unrelated KB files | `RuntimeError(INVALID_REQUEST): unsupported runtime operation: export` | Current root index parses as OKF v0.2, delimiters are valid, KB `index.md` is plain Markdown, unrelated files survive, and the focused run passed `24` tests |
| Integrity-valid history with dangling KB, source, observation, justification or relationship references is rejected | The five independent fixtures were accepted; the focused test reported `Missing expected rejection` | `StorageError(HISTORY_CORRUPT)` validates IDs, KB parents, node/source/observation links, justification groups and relationship endpoints before graph use; focused run passed `25` tests |
| Nested KB parent and inherited-object-key scope errors | Nested child creation was accepted; `kb: "toString"` widened into an empty result | Nested parents now fail with `INVALID_SCOPE`; inherited object keys fail with `NOT_FOUND`; focused runs passed `26` and `27` tests |

A stale `expectedRevision` regression was also run against `create_kb`; the
existing guard passed immediately and durable revision remained unchanged
(`28` tests passed). No new red result is claimed for that already implemented
check.

## Export collision correction

Review found that a first export could overwrite a human-created
`kb/shared/index.md`. The new public regression was run before the fix with:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  npm test -- --test-name-pattern='human-owned generated destination'
```

It failed with `Missing expected rejection`, and the human bytes had been
replaced. The minimum fix preflights every generated destination, rejects
unowned existing files, and only writes after all targets pass. The same
command then passed with no root index, manifest, or human-byte changes. A
follow-up focused run:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  npm test -- --test-name-pattern='export (writes|refuses)'
```

passed all `29` tests. The export fixture now also places an integrity-valid
retained claim in durable history and independently parses its concept
frontmatter, while checking the reserved root and KB index rules.

The domain-reference fixture was strengthened after its initial green run so
each case has valid neighboring data: a source fixture has a valid node beside
the invalid source link, an observation fixture has a valid source beside the
invalid source ID, the justification fixture has a valid conclusion with only
the premise dangling, and the relationship fixture has one valid endpoint.
This was coverage enhancement, not a new historical red. The focused command
was rerun and passed all `29` tests:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  npm test -- --test-name-pattern='dangling domain references'
```

The currently implemented runtime operations are `knowledge_bases`,
`create_kb`, `capture_source`, `record`, `justify`, `why`, and `export`. The
remaining operation discriminants are typed and documented for transport
integration but still fail as unsupported until their own red test is run.
This keeps later work aligned with the one-behavior red/green sequence in
`docs/planning/tdd-plan.md`.

## Primary ADR chain: GREEN

The next coherent public behavior test now covers the complete intended
scenario: project and child KB setup, real file capture, an accepted shared
constraint, a locally justified claim, three options, a decision with an
atomic original basis, an ADR artifact, `why` ancestry/provenance, and an
independently parsed readable export. It deliberately runs through the public
dispatcher and uses real temporary files.

The exact RED command was:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  npm test -- --test-name-pattern='complete ADR evidence chain'
```

Result: the existing bootstrap, export, and regression tests passed (`30
passed`), while the new chain failed at its first missing behavior with:

```text
Error [RuntimeError]: unsupported runtime operation: capture_source
code: INVALID_REQUEST
```

The minimum GREEN implementation adds only the operations exercised by this
chain. `capture_source` resolves and reads a project-relative file through the
file provider, stores an immutable observation with the exact-byte SHA-256
revision, creates linked source/evidence nodes for present content, and records
later changes. `record` validates scope and node semantics, creates decision or
artifact basis groups atomically with the node, and records the revision of
that basis. `justify` adds a current support alternative with cycle checks.
`why` evaluates support at an explicit time, returns original basis separately
from current alternatives, walks upstream ancestry, and returns retained source
provenance. The readable exporter renders the IDs, rationales, premises,
observation revision and observed text into generated concept documents.

The exact GREEN command was:

```text
npm test -- --test-name-pattern='complete ADR evidence chain'
```

Result: the focused chain and the selected existing tests passed (`10 passed,
0 failed`). The complete build and suite then passed (`33 passed, 0 failed`).

## Standards coverage and support-tree refactor

The standards review found that the ADR fixture asserted ancestry by
containment but did not independently assert support status. The fixture now
checks that a claim before any declared basis is `pending` and that the full
accepted evidence chain is `usable`; its expected upstream IDs are compared as
an exact set. A separate public fixture checks that an AND group remains
`pending` when one requirement is not accepted, and that a future
`validFrom` bound is pending before its evaluation time and usable at the
boundary.

The runtime and serializer previously carried duplicate support traversal
logic. `src/support-tree.ts` now builds one deterministic, cycle-safe semantic
representation, while runtime queries derive exact IDs/provenance from it and
the serializer owns only Markdown rendering. The direct runtime verification
after these coverage and refactoring changes passed `12` tests with `0` failed;
the complete package suite subsequently passed `47` tests with `0` failed after
the MCP lifecycle fixture's response-shape correction.

## Support-cycle review correction: GREEN

The first review of the ADR slice found that cycle detection traversed the
proposed edge in the wrong direction. A public regression created `A` supported
by `B`, then attempted to add `B` supported by `A`, and also checked that the
rejected attempt did not advance the durable revision.

The exact RED command was:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  node --test test/runtime.test.ts \
  --test-name-pattern='rejects a justification that would close a support cycle'
```

Result: the new test failed with `Missing expected rejection`; the attempted
cycle was incorrectly committed.

The minimum fix makes the check traverse each proposed premise toward the
conclusion through the existing support graph before committing. The exact
GREEN run passed the focused regression (`11 passed, 0 failed` including the
selected existing runtime tests), and the complete suite passed (`34 passed,
0 failed`).

## Scope and source identity corrections: GREEN

The first P1 regression created a shared conclusion and a child-only premise,
then attempted to justify the shared conclusion from the child scope. Before
the correction, the request was accepted and a sibling `why` query could see
the child premise; the public test failed with `Missing expected rejection`.
The minimum fix rejects a shared conclusion whose declared premise is
child-scoped before the transaction begins. The test also checks that the
rejected request does not leak the premise into the sibling view.

The second P1 regression captured `first.txt` in `child-a`, then reused its
source ID for `second.txt` in `child-b`. Before the correction, the source ID
could be retargeted. The public test failed with `Missing expected rejection`.
The minimum fix resolves the requested locator and checks the existing source
provider, locator and owning KB before fetching or mutating; retargeting now
returns `CONFLICT`, while a source reused with its original locator remains
unchanged.

Standards re-review identified that the first regression changed both locator
and KB, so its `CONFLICT` assertion did not exercise the owning-KB guard. The
fixture now reuses the original `sourceId` with the original `first.txt`
locator from `child-b` and independently expects `SCOPE_VIOLATION`; a second
revision read confirms that this request also leaves durable state unchanged.
This additional check passed immediately against the existing correction, so
no historical RED result is claimed.

The focused verification of both public regressions passed, and the complete
runtime/package suite now passes `50` tests with `0` failures.

## Scope ownership and scoped export corrections: GREEN

The scope re-review found that a child-owned justification could still attach
to a shared conclusion when all of its premises were shared. The new public
regression created that exact case and expected a sibling `why` query to show
no support or child rationale. Before the correction it failed with
`Missing expected rejection`; the request committed a child-owned
justification. The minimum fix requires a justification's KB to match its
conclusion's KB, and the runtime, support tree and serializer now filter
malformed out-of-scope justification records defensively. The focused
regression then passed with unchanged revision and an empty sibling support
result.

The second scope regression recorded a child-A relationship pointing to a
shared node, exported sibling child B, and independently checked the shared
document's parsed extension and bytes for the child ID and private rationale.
Before the correction it failed because the child-owned relationship was
included on the shared document. Filtering relationships by their owning KB
keeps the relationship on the child-A document while the sibling export stays
free of it. The focused test passed after the subsequent scoped-manifest
correction below was applied.

The scoped-export regression then exposed a separate P1: exporting child B
replaced the manifest with only B/shared entries while leaving child-A files in
place, so the next mutation committed history and failed projection preflight
with `PROJECTION_FAILED`. The minimum fix carries forward prior manifest
ownership entries for untouched generated files while returning the files
written by the current export. Its public test now verifies that a later
child-A mutation publishes successfully and advances exactly one revision.

The three correction regressions pass individually, and the full pinned
Node v24.21.0 suite passes `50` tests with `0` failures.

## Post-commit projection failure correction: GREEN

The P1 filesystem regression made `.justification/` unwritable immediately
before a mutation. Before the correction, history revision `1` was durable
but the caller received a raw `EACCES` error without the committed revision.
The minimum storage seam now invokes projection publication after the history
rename and wraps failures with the committed revision. Runtime maps that
wrapper to `PROJECTION_FAILED`, including `committed: true` and recovery
guidance to rebuild after fixing the projection filesystem. The public test
then verified that `knowledge_bases` still reports revision `1` after the
failure.

## Applicability and projection correction: GREEN

The P2 applicability regression gave a justification an expired `validUntil`
bound. Before the correction, its group was reported `usable` even though the
justification assessment was pending. Group status now requires both a usable
justification assessment and usable premise assessments; the public test
passed with both statuses pending.

The export regression independently captured a real source, attached it and an
accepted requirement to an ordinary claim, and added a typed relationship.
Before the correction, source links were one directory too shallow and the
generated extension omitted support groups, relationships and retained
provenance. The serializer now computes links relative to each generated
document, preserves those records in the extension, and renders navigable
premise links. The public export test parses the generated YAML and checks the
exact premise, relationship and provenance values. The focused correction
verification and the complete `47`-test suite passed with `0` failures.

## Source-change lifecycle: GREEN

The documented source-maintenance shapes were added before the public test.
The fixture creates two isolated projects, captures a real UTF-8 source,
retains its evidence, builds a claim → decision → artifact support chain, and
records an independently hashed pre-change explanation at a fixed revision and
evaluation time. The fixture then changes the source; its subsequent assertions
cover the documented source/evidence inspection, impact paths, review listing,
current and historical `why`, unchanged refresh and cross-project checks.

The intentional first RED run was:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  npm run build && \
  PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  node --test --test-name-pattern='refreshes changed evidence and exposes the exact ADR impact' \
  test/runtime.test.ts
```

The real temporary-project setup passed through the historical explanation and
source mutation. The first missing behavior was the selected `refresh`
operation, so the later assertions were not reached. It failed with:

```text
Error [RuntimeError]: unsupported runtime operation: refresh
code: INVALID_REQUEST
```

The minimum implementation uses one transition helper for `capture_source`
and `refresh`. It compares durable availability, digest and provider revision,
retains every observation and present-content evidence node, appends a
`ChangeRecord` for real transitions, and creates one open change review for
the prior evidence plus each declared downstream dependent. An unchanged
refresh returns the selected source records with empty observation, change and
review arrays and does not advance the semantic revision. Query operations
read source, evidence, change and review records from validated history;
`impact` traverses support and typed dependency links with inclusive paths.
Current `why` retains all observations for sources in its support tree, while
historical `why` reads the selected immutable revision. Evidence is usable
again when a restored source has the same digest and provider revision, even
though the independent review remains open.

The GREEN verification passed the focused source lifecycle test (`21 passed,
0 failed` in the selected runtime run) and the pinned Node v24.21.0 build and
typecheck passed. A direct temporary-project check also covered
present → missing → restored transitions: restoration advanced one revision,
created a new observation, returned no duplicate review work, and made the
original evidence usable by digest/provider revision. The complete package
run remains subject to the separate recovery and request-validation workers'
tests; those unrelated failures are recorded by their owning slices.

## Scoped source-review response correction: GREEN

The scoped source regression created one shared source whose retained evidence
supported claims in two child KBs. Before the correction, a refresh requested
for child A returned the durable review for child B as well, even though the
child B review was correctly persisted. The focused public test failed with
`true !== false` after 21 passing runtime tests.

The minimum correction filters mutation response arrays by the requested KB
after the shared-source transition has propagated reviews globally. The
durable review list remains scope-aware, so a later `review` query for child B
still exposes its affected claim. The focused runtime verification now passes
22 tests with 0 failures; typecheck and `git diff --check` remain green.

## Repeated source-change propagation correction: GREEN

The retained-observation regression exercised a source changing from A to B,
returning to A, and then changing to C. The original A evidence made the
claim and its generic research output usable again after restoration, but the
next change initially seeded review only from the immediately previous A
observation. The public test therefore failed when the latest change lacked a
review for the original evidence (`false !== true`) despite 22 passing runtime
tests.

The minimum correction finds every retained evidence node for the source that
is actually referenced by a support basis. On each source transition it
compares those observations with the new source digest and provider revision,
then reviews only the mismatching prior bases and their downstream dependents.
The newly captured current evidence is retained for provenance and impact but
is not treated as an old basis. Distinct changes receive distinct review
triggers, so a later change can create new work even when an earlier review is
eventually acknowledged. The focused runtime verification now passes 23 tests
with 0 failures; typecheck and `git diff --check` remain green.

## Operational source-availability correction: GREEN

The availability regression captured a real source and a claim → artifact
support chain, removed directory read access, and refreshed the known source.
Before the correction, provider resolution surfaced a raw
`ProviderError(PROVIDER_UNAVAILABLE)` and left the durable source marked
present. The public test therefore stopped before it could inspect the
transition.

The minimum correction maps known-source provider resolution and fetch access
failures to a durable `denied` or `unavailable` provider result. The shared
source-transition path then appends an unavailable observation and
`availability_changed` record, reviews the retained evidence and declared
dependents, and makes current `why` assessment pending. Repeating the same
availability state remains revision-idempotent through the existing
availability comparison. Invalid locator errors, including escaping symlinks,
continue to propagate instead of becoming source state. Capture and refresh
use the same narrow provider-failure mapping for an already identified source.

The pinned Node v24.21.0 verification passed all 24 runtime tests, including
the inaccessible-source regression, with 0 failures. `npm run typecheck` and
`git diff --check` also passed.
