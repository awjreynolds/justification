# MVP acceptance evidence

This checklist tracks the original brief's eighteen MVP requirements. It does
not treat a declared request type, future-facing documentation or a model's
answer as evidence that an operation works. Pending rows must be completed
before reporting the MVP delivered.

| Requirement | Public verification | Status |
| --- | --- | --- |
| 1–4: initialization, discovery, shared and child KBs | Runtime and CLI tests with real temporary directories; one MCP server lists two configured projects and creates a child | Verified |
| 5: OKF-compatible Markdown | Independently parsed frontmatter, pinned OKF v0.2 root index rules, navigable source links, structured support groups and provenance, scoped ownership/drift checks | Current reasoning projection verified; recovery and later conflict/review projection checks pending |
| 6–10: sources, claims, decisions, artifacts and provenance | File capture → retained evidence → claim → decision with acceptance basis → ADR; independent source digest and readable provenance | Recorded chain verified by runtime and restarted legacy MCP client; maintenance scenario pending |
| 11: shared inheritance | Child visibility and rejected sibling/shared-to-child references; explicit promotion | Node, support and relationship scope checks verified; promotion and KB case-collision correction pending |
| 12–13: why and impact | Exact upstream chain, original acceptance revision, exact affected downstream IDs after a source change | Pending |
| 14–15: contradictions and review issues | Attributed conflict, explicit directional resolution, preserved history, deduplicated and subsequent review work | Pending |
| 16: one external provider | Real project-relative UTF-8 files; content/availability transitions; path containment and bounded reads | Provider containment, bounded reads and exact-byte capture reviewed; refresh/availability lifecycle pending |
| 17: MCP | Actual SDK stdio clients and installed Codex; two configured projects, structured errors, restart and full ADR workflow | Production SDK ADR capture/why/restart and installed Codex project/KB calls verified; maintenance and foreign-node isolation lifecycle pending |
| 18: deterministic rebuild | Delete disposable state, rebuild from native history, compare queries at a fixed revision/time and restore a native backup | Pending |

Additional contract checks cover alternative AND/OR support, explicit
applicability, artifact drift, bounded scoped context, unsupported consequential
nodes, history integrity and optimistic write conflicts. These checks explain
the limits of the result: available declared support does not verify a
proposition or infer semantic entailment.

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
