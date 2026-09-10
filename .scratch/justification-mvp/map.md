# Find the route to a traceable Justification MVP

Label: wayfinder:map
Status: open

## Destination

A completed, reviewed local-first MVP proving an ADR can be traced to retained evidence and flagged for review when its support changes. The user subsequently instructed completion while away; the implementation contract records routine design decisions made under that authorization.

## Notes

- The earlier planning-only gates were superseded by the user’s instruction “Continue until complete. Going afk”. Continue the full original MVP autonomously, record agent choices accurately and preserve TDD and the model assignments. The [MVP contract](../../docs/planning/mvp-contract.md) and [design review](../../docs/implementation/mvp-contract-review.md) govern implementation.
- Init/discovery is implemented and reviewed; the complete runtime and actual-client MCP experiment are now in progress.
- Implementation: **gpt-5.6-luna, max** (the user's “Lunar Max”). Code review: **gpt-6-astra, medium**. Do not silently substitute models or lower their effort. Research is a separate role.
- The user confirmed the runtime, CLI and MCP test seams. Use one behavioral test and minimum implementation per red–green cycle under the [TDD plan](../../docs/planning/tdd-plan.md); reuse that confirmation rather than asking again.
- Before selecting or upgrading a volatile model, SDK, protocol or format dependency, check its current primary documentation, release status and actual compatibility. Record the check date, exact version/revision, evidence and limitations; newness alone is not a quality claim.
- Retain the decision map as a record. The later user instruction authorizes routine agent decisions across the earlier HITL tickets; each answer identifies that authority and does not imply that the user answered it individually.
- Tracker: local Markdown, per the installed Wayfinder fallback. Each file in `issues/` is a child; `Blocked by` records dependencies. Claim by setting `Status: claimed` and `Assignee: awjreynolds` before work. Resolve by appending `## Answer` to the ticket, setting `Status: resolved`, and adding a linked gist here.
- Frontier: open, unassigned children whose blockers are resolved, sorted by filename. Open tickets are discovered from `issues/`, not duplicated in this index.
- Preserve the original scope: the product owns justification and provenance; providers remain authoritative. MIT/public repository; no application code exists at the start of this map.
- Context: [Original project brief](../../docs/planning/original-brief.txt), [Brief review and candidate route](../../docs/planning/brief-review.md). The review contains proposals, not accepted decisions. [Independent planning review](../../docs/planning/plan-review.md).

## Decisions so far

- [Establish which Open Knowledge Format specification the MVP can target](issues/01-okf-compatibility.md): Located the canonical v0.2 specification; Justification semantics and round-trip guarantees need an explicit profile.
- [Identify the minimum rigorous semantics for provenance and weakened support](issues/02-justification-semantics.md): Separated provenance, asserted support and potential impact; AND/alternative support and applicability need explicit rules.
- [Verify current MCP and source-change contracts for a local runtime](issues/03-mcp-provider-contracts.md): Verified current protocol and change-signal contracts; actual client/SDK compatibility requires a separate check.
- [Verify current engineering and AI evaluation methods before implementation](issues/15-current-methods.md): Current guidance supports executable evidence and separate review; volatile integrations need dated version and compatibility checks.

- [Agree the smallest ADR demonstration that proves the product](issues/04-mvp-proof.md): The original ADR scenario is the acceptance proof, extended with a second isolated project, unchanged-refresh deduplication and cold rebuild.
- [Define the minimum evidence and justification model](issues/05-minimum-domain.md): Use immutable project-local node IDs, first-class retained evidence, a small shared node envelope and typed forms for constraints/options.
- [Separate freshness, belief and review state without rewriting history](issues/06-state-review.md): Keep source availability, evidence freshness, declared support and review independent.
- [Choose durable authority and an honest OKF compatibility boundary](issues/07-persistence-authority.md): One append-only project history is authoritative: numbered digest-linked complete JSON snapshots committed atomically under a lock.
- [Define shared inheritance, explicit promotion and project isolation](issues/08-scope-identity.md): Use one shared-to-child inheritance level and immutable IDs.
- [Define a deterministic provider and selective-refresh transaction](issues/09-refresh-contract.md): Use capability-based file provider with project-relative contained paths, retained UTF-8 observations and deterministic digest/state comparison.
- [Choose artifact assertion anchors and acceptable drift behavior](issues/11-artifact-contract.md): Trace whole artifact to explicit decision/claim basis and acceptance revision, plus project-relative file locator/content digest.
- [Choose the MCP clients and compatibility baseline the MVP must support](issues/13-client-baseline.md): The bounded baseline is the current released TypeScript SDK client and installed Codex CLI 0.153.4 over local stdio.

- [Verify a pinned MCP SDK against the agreed client matrix](issues/14-client-smoke.md): Pinned SDK server/client 2.0.0 and Zod4.6.1 were exercised over real stdio, with modern2026-07-28 and legacy2025-11-25 discovery, structured calls/errors and restart.
- [Specify the runtime, CLI and bounded MCP contract](issues/10-runtime-mcp.md): Use TypeScript on the pinned Node24 toolchain and one public executeOperation(root,request) dispatcher returning revision/data.
- [Agree the implementation sequence and evidence required at each review](issues/12-implementation-handoff.md): Confirmed seams remain runtime, process CLI and actual MCP clients.

## Remaining delivery work

- Complete Luna-max runtime/CLI/MCP red–green cycles and capture executable evidence.
- Production multi-project schemas/calls remain to be verified; the SDK/Codex fixture compatibility experiment is complete.
- Run independent Astra-medium code reviews, fix material findings through Luna and re-review.
- Ship the runnable ADR example, operation/backup documentation and optional agent skill; verify packaged installation and push reviewed work.

Current sequence after the reviewed ADR foundation: source-change propagation,
strict shared request validation, and deterministic recovery; then explicit
review/conflict resolution, promotion, bounded queries and artifact audit.
Source maintenance and recovery each begin with a public failing behavior.
The shared-schema extraction's first rejection test preceded its runtime hook;
later validation clauses were prepared before their tests and must be recorded
as verification rather than historical test-first evidence.

A public check on the development Mac accepted `create_kb` with ID `Shared`
at revision 1, where `kb/Shared` and `kb/shared` had the same inode. Correct
case-insensitive path collisions before completing scope acceptance.

## Delivery decisions recorded by the examples/documentation slice

- The worked fixture uses a fictional checkout-cache benchmark with one shared
  latency constraint, three options, one retained file observation, an
  attributed claim, a Redis decision and a whole-file ADR artifact. The example
  keeps IDs runtime-generated and checks independent expected values rather than
  mirroring internal graph traversal.
- `examples/adr-demo.mjs` creates a temporary workspace by default and accepts
  `--root` only for an empty directory. It leaves the generated workspace in
  place so the printed native history and projection paths can be inspected.
  It imports the built public package and does not add a package script or
  dependency.
- User-facing recovery guidance treats numbered `justification-history/`
  revisions as authority, `kb/` as a current OKF projection and
  `.justification/` as disposable. It names only typed errors and layouts
  observed in the implementation/contract; runtime-specific response wording
  remains owned by the implementation slice.
- The general knowledge-output example uses two fictional file captures, two
  independently justified claims, an open question and a generated research
  brief recorded as an artifact with the survey claim as direct basis. The
  independent notes claim remains a separate reusable branch. It changes only
  the survey source, checks exact impact and review IDs while the independent
  notes remain unaffected, reports the current brief as pending reassessment,
  and compares a historical `why` response at the artifact revision. The ADR
  example remains available through `demo:adr` and now asserts its exact
  source-to-artifact impact and review chain.
- CI uses only `ubuntu-latest`, declares top-level `contents: read`, and pins
  the dated official releases `actions/checkout` v7.0.1 and
  `actions/setup-node` v7.0.0 to full commit hashes. The release and
  compatibility check is recorded in
  [ci-baseline.md](../../docs/implementation/ci-baseline.md); no other runner
  platform is claimed.

## Delivery decisions recorded by the primary ADR runtime slice

- The first complete runtime behavior uses a project-relative UTF-8 file
  provider, exact-byte SHA-256 observations, one retained evidence node per
  present observation, explicit support groups, and revision-pinned original
  basis for decision/artifact records. `why` reports that original basis,
  later alternatives, deterministic upstream ancestry and retained
  provenance; the generated Markdown projection renders the same identifiers
  and rationale for a reader without the runtime.
- The slice intentionally stops after `capture_source`, `record`, `justify`
  and `why` plus the existing export behavior. Refresh, impact, review,
  promotion, conflict, rebuild and search semantics remain pending their own
  public red-green cycles rather than being inferred from this chain.
- Review of the support graph exposed and corrected a traversal-direction bug:
  when adding `conclusion -> premise`, cycle detection now checks whether the
  existing graph already reaches the conclusion from that premise. A public
  `A <- B <- A` regression records both the rejected error and unchanged
  durable revision.

## Delivery decisions recorded by the recovery slice

- The first rebuild response is a read-only `{ revision, data }` result. Its
  data reports `rebuilt: true`, `committed: false`, the unchanged semantic
  revision, deterministic disposable index metadata and generated projection
  ownership metadata. The exact shape and first red-green evidence are in
  [recovery-tdd.md](../../docs/implementation/recovery-tdd.md).
- Disposable projection state is kept out of Git by the managed
  `.justification/.gitignore` created with every projection-root creation;
  existing root `.gitignore` bytes are preserved, while numbered history and
  generated `kb/` documents remain trackable. The focused Git-ignore recovery
  behavior and green evidence are recorded in
  [recovery-tdd.md](../../docs/implementation/recovery-tdd.md).
- The first recovery fixture uses a real file observation, claim support and
  decision basis, then compares fixed-time `why` output and generated files
  after deleting the complete `.justification/` tree. It also rebuilds a copy
  containing only native descriptor/history, source and unrelated KB content.
  It intentionally leaves individual missing projections, manual edits,
  projection-failure repair and malformed-history recovery to later tests.

## Delivery decisions recorded by the correction slice

- The first P1 scope correction rejects a child-scoped premise on a shared
  conclusion before commit, so a sibling knowledge-base query cannot inherit
  support that is only valid in the child. The source-identity correction
  checks the existing provider, locator and owning KB before fetch or mutation;
  source IDs remain bound to their original identity.
- Projection publication runs after the numbered history revision is renamed.
  If that I/O fails, the runtime reports `PROJECTION_FAILED` with the durable
  revision, `committed: true` and rebuild recovery guidance. The regression
  verifies that the semantic revision remains discoverable after the error.
- Justification group status combines the justification's applicability with
  every premise assessment. The exporter uses one cycle-safe support tree for
  runtime ancestry, provenance and Markdown reasoning, and retains support
  groups, typed relationships, source links and provenance in the generated
  extension. The correction evidence is recorded in
  [runtime-tdd.md](../../docs/implementation/runtime-tdd.md) and
  [adr-chain-review.md](../../docs/implementation/adr-chain-review.md).
- A justification must be owned by the same KB as its conclusion; runtime
  queries and serialization apply the same ownership rule to malformed state.
  Relationships are emitted on their owning KB's document, so a child-owned
  edge pointing to shared knowledge does not appear in a sibling's shared
  export. Scoped exports carry forward manifest entries for untouched
  generated files, preserving ownership for later mutations.
- The dependency lock remains `package-lock.json` lockfile version 3 with the
  pinned project versions. `npm ci --ignore-scripts --dry-run` completed under
  the pinned Node v24.21.0 toolchain on 2026-09-10, and the lockfile has no
  uncommitted changes.

## Delivery decisions recorded by the source-maintenance slice

- `capture_source` and `refresh` share one durable source-transition path.
  A source identity remains bound to its provider and locator; changed content
  or availability creates a new immutable observation, present-content
  evidence and a `ChangeRecord`. The source's operational `lastCheckedAt` is
  changed only when a semantic transition is committed, so unchanged refresh
  is revision-idempotent.
- Change reviews attach to the prior evidence and its downstream support or
  typed dependency records. New evidence is retained for impact and history
  without silently replacing the old basis. Restoration with the same digest
  and provider revision makes retained evidence usable again while the open
  review remains an independent acknowledgment item.
- Source and evidence inspection, changed-source enumeration, impact paths and
  review listing read the validated append-only state directly. `why` adds
  scoped review/change records and every retained observation for sources in
  the support tree; selecting a historical revision keeps these arrays tied to
  that immutable snapshot. Unknown KB names are resolved case-sensitively
  before shared-node visibility is granted.
- The source-maintenance implementation was exercised through the public
  runtime using real temporary project files. The focused runtime slice passed
  21 tests with the pinned Node v24.21.0 build and typecheck; the full package
  run's unrelated recovery/request-validation failures remain owned by those
  slices.
- A scoped refresh returns only reviews visible in its requested KB, while a
  shared-source transition still persists reviews for all dependent child
  scopes. The public regression first observed child B's review leaking into a
  child A refresh response; the correction filters only the response and
  preserves the durable child B review for a subsequent scoped query. The
  focused runtime run then passed 22 tests with 0 failures.
- Repeated source changes propagate from every retained evidence node that is
  still referenced by a support basis and whose digest/provider revision no
  longer matches the current source. This preserves immutable observations,
  lets restored matching bytes become usable, and creates a fresh review
  trigger for the original evidence and dependents when a later distinct
  change makes them pending again. Newly captured current evidence is never
  marked as an old basis. The A → B → restored A → C public regression and
  the prior runtime suite pass 23 tests with 0 failures.
- Operational provider failures for a known source are recorded as durable
  `denied` or `unavailable` observations through the same capture/refresh
  transition owner. The transition records availability change and reviews
  retained evidence plus declared dependents; repeated identical availability
  remains revision-idempotent, while invalid locators (including escaping
  symlinks) still fail before commit. The inaccessible-directory regression
  passed all 24 runtime tests on pinned Node v24.21.0, with typecheck and
  `git diff --check` green.
- The portability regression for an explicit `record.id` first committed a
  lowercase UUID, then exposed that uppercase spelling could reach semantic
  commit and collide with the existing generated path on a case-insensitive
  filesystem (`PROJECTION_FAILED`). The request schema now rejects explicit
  UUIDs whose spelling is not already lowercase with `INVALID_REQUEST` before
  revision advance. Generated IDs remain unchanged; the focused validation
  run passed 11 tests, with typecheck and `git diff --check` green.
- Source change reviews seed from every retained evidence node whose observed
  source state is stale, then traverse declared support and dependency edges.
  This covers standalone old evidence and explicit artifact dependencies even
  when no justification directly names the evidence; freshly matching current
  evidence remains unreviewed. The regression first returned an empty review
  set and now passes as part of the 25-test runtime verification.
- Source impact and review propagation also traverse direct dependencies of
  the source graph node. The regression for an artifact linked directly to a
  source first omitted that artifact from impact and reviews; the correction
  preserves source-to-artifact paths, retains old and new evidence in impact,
  and reviews only the old evidence plus the artifact. The runtime suite now
  passes 26 tests with typecheck and `git diff --check` green.
- Durable source records no longer expose `lastCheckedAt`; polling time is
  operational metadata and each immutable observation carries its own
  attribution. A public assertion first caught the field on capture, then the
  type and transition snapshot were narrowed. The 26-test runtime suite,
  typecheck and diff check pass after the cleanup.

## Delivery decisions recorded by the review-closure slice

- Review closure is an explicit mutation of one durable review record. It
  requires a visible review ID, the `closed` status, a nonempty actor and
  rationale, and stores normalized closure time plus a typed closure-history
  entry. The original trigger and creation attribution remain unchanged.
- An identical repeat with the current expected revision returns the same
  review at the same semantic revision with `committed: false` and
  `idempotent: true`; the transaction layer now supports this lock-aware
  no-op result so idempotent retries do not publish a new history snapshot.
  Stale expected revisions are still rejected, and differing closure metadata
  conflicts rather than appending a second acknowledgment.
- Closing a review records acknowledgment only. It does not refresh evidence,
  make stale support usable or resolve contradictions. A later source change
  creates a separate open review keyed by its new change trigger. The public
  review fixture records the meaningful RED (0 passing, 1 failing) and GREEN
  result (1 passing, 0 failing); the focused build and test run completed on
  2026-09-10 under Node v24.21.0.

## Delivery decisions recorded by the audit slice

- The first audit contract is a read-only, revision-preserving report scoped to
  shared plus the requested child. It reports unsupported decisions/artifacts,
  missing claim/assertion provenance, stale source support, visible open
  reviews, open contradictions and artifact file drift. Support status is
  supplied by the runtime's existing assessment callback; artifact checks use
  the bounded project-relative file provider and never rewrite files. The
  first public fixture's RED and result shape are recorded in
  [audit-tdd.md](../../docs/implementation/audit-tdd.md).

## Delivery decisions recorded by the bounded query slice

- Search, context and trace are read-only projections over the validated current
  revision. Search and context summaries reuse the runtime's injected support
  assessment and expose `supported`, `assumed`, `disputed` and `pending`
  independently; lexical snippets remain excerpts rather than generated prose.
- Context anchored on a node traverses declared support and retained source
  provenance, omits its anchor, orders direct knowledge before outputs, and
  supports a lexical filter when a query is supplied. Trace follows
  justification, evidence-to-source and typed-link edges in either direction
  with cycle-safe inclusive paths and deterministic reasons.
- Query summaries keep review workflow independent from support. Each result
  includes `reviewRequired` and sorted `openReviewIds`; an accepted alternative
  can keep support usable while a changed original basis still requires review.
  Review and contradiction triggers are filtered to the requested KB, so
  child-owned work does not leak into shared queries.
- All three query projections fit the complete `{ revision, data }` envelope by
  UTF-8 byte length, returning a deterministic prefix with `truncated: true`
  or a calculated minimum-envelope error. Public query fixtures recorded RED
  and GREEN evidence in [query-tdd.md](../../docs/implementation/query-tdd.md).
- The bounded query verification also exercised four large multibyte summaries
  at a fixed near-boundary budget and the typed minimum-budget error for all
  three operations. Two child KBs with shared and child-owned open
  contradictions, reviews, public typed-link cycles and artifacts confirmed
  exact scope isolation, dispute/review flags and finite cycle paths without
  changing the query implementation.

## Delivery decisions recorded by the contradiction and relationship slices

- Contradictions are scoped records with explicit endpoint IDs, rationale,
  attribution, status and resolution history. A child conflict can mention an
  inherited shared endpoint, but its private record and review work remain
  child-scoped. Supersession must name one endpoint as `winnerId`; other
  resolutions preserve prior entries, while `unresolved` deliberately leaves
  the conflict open. No resolution rewrites node support or content.
- Contradiction and review metadata are rendered into the owning node's
  readable OKF extension. Shared and sibling projections filter out a
  child-owned contradiction, including its endpoint IDs and rationale; scoped
  conflict, search and `why` queries apply the same visibility rule.
- Relationships are attributed typed edges owned by their source node's KB.
  They may point to inherited shared nodes and may form ordinary cycles, while
  sibling child endpoints and shared traces reject or omit child-owned edges.
  The public knowledge-actions fixture records the contradiction and
  relationship red/green results: 2 passing/1 failing at each first
  unsupported operation boundary, then 3 passing/0 failing after the bounded
  handlers landed. The focused runs completed on 2026-09-10 under Node
  v24.21.0; `npm run typecheck` and the package build are now green. The full
  suite still has the unrelated unfinished `audit` dispatcher slice failing,
  which remains with that implementation owner.
- The owning node's Markdown body now renders review status/reasons and
  closure rationale, plus conflict status and attributed resolution rationale,
  in addition to the structured extension. A public RED first showed the
  frontmatter-only projection was insufficient (1 passing, 2 failing), and the
  focused knowledge-actions run is GREEN at 3 passing/0 failing after the
  scoped body renderer was added.

## Delivery decisions recorded by the review-regression slice

- A repeated close of an already closed review with matching actor and
  rationale, the current expected revision and no `at` is an idempotent
  acknowledgement. It preserves the first stored `closedAt`, closure history,
  semantic revision and generated bytes; an explicitly different timestamp
  remains a conflict. The public regression first returned `CONFLICT` after
  creating a fresh timestamp (2 passing, 1 failing), then passed with the
  minimum handler correction at 4 passing/0 failing.
- A contradiction explicitly owned by a child must have at least one endpoint
  owned by that child. Both-shared endpoints are rejected with
  `SCOPE_VIOLATION` and `{ kb, left, right }` before commit because a child
  rationale/review would have no readable owner. The public regression first
  committed the ownerless record (`Missing expected rejection`, 3 passing, 1
  failing), then passed at 4 passing/0 failing with unchanged revision and
  projection/human bytes. The existing child-vs-shared fixture also verifies
  that `why`, `review` and `audit` exclude the child conflict from shared and
  sibling scopes while exposing it in the owning child.
- Promotion is an attributed explicit move through the public runtime seam.
  A successful move preserves immutable node, support, relationship and
  creation fields, changes their owning KB to `shared`, appends a scope
  change, and republishes projections. The first fixture deliberately reached
  the unsupported dispatcher (`0 passing, 1 failing`); the focused success
  test now passes and removes only the validated generated child path after
  disposable cache loss, preserving an unrelated human file and historical
  `why` results.
- Promotion validates every persisted dependency that can expose child-only
  knowledge: support premises, recorded decision/artifact basis, considered
  and selected options, outgoing relationship targets, and source provenance
  for captured evidence. Child-owned references return actionable
  `SCOPE_VIOLATION` details without advancing revision. The recorded basis
  test passes through the existing atomic support record with
  `dependencyKind: "justification_premise"`; no diagnostic-only failure was
  introduced. The option and source/evidence fixtures pass in the seven-test
  promotion run; the later scoped-capture regression brings the focused run
  to eight tests.
- Open child contradictions involving a candidate return `REVIEW_REQUIRED`
  until an explicit resolution is recorded. A resolved child contradiction is
  retained in the child conflict index and its existing review remains
  private after promotion. Caller-supplied conflicts and differing bodies
  under the same optional proposition key create durable, deduplicated
  `promotion_conflict` reviews; closing the review is followed by an explicit
  promotion retry. A public omitted-list retry initially advanced the revision
  and promoted while that review was open (`6 passing, 1 failing`); the
  correction folds persisted open promotion reviews back into the conflict
  plan. The retry now preserves the exact review ID, child scope and revision
  until closure, after which an omitted-list retry succeeds. Review ownership
  is shared by runtime, read queries and serializer so shared and sibling reads
  do not expose child rationale or closure history. The combined promotion,
  knowledge-action and bounded-query verification is 17 passing tests with
  zero failures.
- The final Spec review reproduced a capture leak after promoting a source
  while its evidence remained child-owned: unchanged shared and sibling
  `capture_source` calls returned that child evidence even though scoped
  evidence inspection omitted it. The public regression first observed the
  child descriptor (`7 passing, 1 failing`); the minimum correction filters
  returned evidence by the effective capture KB on both fast and transaction
  paths. Shared and sibling unchanged captures now preserve the same revision
  and omit evidence until its separate promotion; the focused promotion run
  passes 8 tests with typecheck and whitespace checks green.

## Out of scope

- The broader vision beyond the original MVP: the delivery limits in the implementation contract remain explicit.
- Full ATMS, PROV, SACM, IBIS/QOC or OSLC implementations; their useful concepts may inform the MVP.
- UI, SaaS hosting, vector search, automatic contradiction adjudication, full code indexing, and replacing source systems.
- Production adapters for every listed provider, rich document sentence anchoring, and autonomous semantic refresh across arbitrary corpora. The MVP must preserve an extension path without implementing these now.
