# MVP acceptance evidence

This checklist tracks the original brief's eighteen MVP requirements. It does
not treat a declared request type, future-facing documentation or a model's
answer as evidence that an operation works. Pending rows must be completed
before reporting the MVP delivered.

| Requirement | Public verification | Status |
| --- | --- | --- |
| 1–4: initialization, discovery, shared and child KBs | Runtime and CLI tests with real temporary directories; one MCP server lists two configured projects and creates a child | Verified |
| 5: OKF-compatible Markdown | Independently parsed frontmatter, pinned OKF v0.2 root index rules, navigable source links, structured support groups and provenance, scoped ownership/drift checks, readable conflict and review history | Verified, including promotion and child-index history; final promotion review pending |
| 6–10: sources, claims, decisions, artifacts and provenance | File capture → retained evidence → claim → decision with acceptance basis → artifact; direct claim-to-research-output support; independent source digest and readable provenance | Verified in runtime and real MCP tests; both runnable examples pass; source-maintenance review closed |
| 11: shared inheritance | Child visibility and rejected sibling/shared-to-child references; explicit promotion with dependency checks and conflict resolution | Verified in seven promotion fixtures, including persisted conflict gates and cache loss; final independent review pending |
| 12–13: why and impact | Exact upstream chain, original acceptance revision, exact affected downstream IDs after a source change | Verified and reviewed, including direct typed dependencies on evidence and sources |
| 14–15: contradictions and review issues | Attributed conflict, explicit directional resolution, preserved history, deduplicated and subsequent review work; optional-timestamp closure retries; rejected ownerless child conflicts | Verified; both Spec corrections closed at `7ac5c22` |
| 16: one external provider | Real project-relative UTF-8 files; content/availability transitions; path containment and bounded reads | Verified and reviewed, including lost access, restored content and a later change |
| 17: MCP | Actual SDK stdio clients and installed Codex; two configured projects, structured errors, restart and full ADR workflow | Verified; legacy and current SDK lifecycles, maintenance, foreign-node isolation and cache rebuild pass; installed Codex production calls pass; integration review closed |
| 18: deterministic rebuild | Delete disposable state, rebuild from native history, compare queries at a fixed revision/time and restore a native backup | Verified and independently reviewed, including Git-ignore restoration after cache loss |

Additional contract checks cover alternative AND/OR support, explicit
applicability, artifact drift, bounded scoped context, unsupported consequential
nodes, history integrity and optimistic write conflicts. These checks explain
the limits of the result: available declared support does not verify a
proposition or infer semantic entailment.

The parent verified an isolated archive of `7ac5c22` with the pinned Node
v24.21.0 toolchain: typecheck and all 87 tests passed. With promotion, durable
artifact refresh and the additional real MCP lifecycle added, the full working
tree passes typecheck and 100 tests. Both worked examples also pass. Remaining
delivery work is final independent review, a clean packaged installation and
hosted CI verification of the final commit.

Delivery requires the runnable fictional ADR example, current public operation
documentation, recovery instructions, optional agent skill, a clean package
installation, automated checks, independent Standards/Spec review and the
public repository update. Scheduled/remote refresh, automatic semantic
interpretation, arbitrary OKF import and sentence-level anchors are outside the
resolved MVP.

The initial runtime foundations and transport scaffolding were implemented
before meaningful failing tests. That process deviation is documented in
[runtime TDD evidence](runtime-tdd.md) and [transport TDD evidence](mcp-tdd.md).
Later observed red/green cycles and independent reviews must not be presented
as retroactive proof that the initial work was test-first.
