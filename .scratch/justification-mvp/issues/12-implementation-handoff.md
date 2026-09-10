# Agree the implementation sequence and evidence required at each review

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: open
Assignee:
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 04, 06, 07, 08, 09, 10, 11

Prerequisites: [Agree the smallest ADR demonstration that proves the product](04-mvp-proof.md); [Separate freshness, belief and review state without rewriting history](06-state-review.md); [Choose durable authority and an honest OKF compatibility boundary](07-persistence-authority.md); [Define shared inheritance, explicit promotion and project isolation](08-scope-identity.md); [Define a deterministic provider and selective-refresh transaction](09-refresh-contract.md); [Specify the runtime, CLI and bounded MCP contract](10-runtime-mcp.md); [Choose artifact assertion anchors and acceptable drift behavior](11-artifact-contract.md)

## Question

The user has requested TDD. Consult the [TDD proposal](../../../docs/planning/tdd-plan.md); confirm its test seams before writing tests. Plan one failing behavioral test followed by its minimum implementation per cycle, using Luna max. Astra medium reviews the resulting changes and any refactoring. Do not batch-write speculative tests.

Once the design decisions are resolved, what is the smallest sequence of independently reviewable Luna-max changes that delivers the ADR proof? Specify inputs, ownership boundaries, acceptance fixtures and completion gates for each stage; use Astra-medium code review with findings returned to Luna and re-review after material fixes. Include cold rebuild equivalence, no-change refresh, changed/deleted/unavailable sources, alternative supports, scoped contradiction/promotion conflict, artifact drift and multi-project isolation. Also test similarly worded claims that coexist because their subject/version/time applicability differs. Determine which hard-to-reverse tradeoffs warrant ADRs and where the optional agent skill enters. Do not call this handoff ready while design blockers remain open.
