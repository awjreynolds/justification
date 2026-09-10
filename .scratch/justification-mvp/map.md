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

## Out of scope

- The broader vision beyond the original MVP: the delivery limits in the implementation contract remain explicit.
- Full ATMS, PROV, SACM, IBIS/QOC or OSLC implementations; their useful concepts may inform the MVP.
- UI, SaaS hosting, vector search, automatic contradiction adjudication, full code indexing, and replacing source systems.
- Production adapters for every listed provider, rich document sentence anchoring, and autonomous semantic refresh across arbitrary corpora. The MVP must preserve an extension path without implementing these now.
