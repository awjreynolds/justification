# Define a deterministic provider and selective-refresh transaction

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: resolved
Assignee: awjreynolds
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 03, 06, 07, 08

Prerequisites: [Verify current MCP and source-change contracts for a local runtime](03-mcp-provider-contracts.md); [Separate freshness, belief and review state without rewriting history](06-state-review.md); [Choose durable authority and an honest OKF compatibility boundary](07-persistence-authority.md); [Define shared inheritance, explicit promotion and project isolation](08-scope-identity.md)

## Question

Which first provider and capability-based interface prove selective refresh at the lowest cost? Separate stable source identity, observed revision, cheap change signal, normalized ChangeSet and optional semantic interpretation. Define unchanged, changed, deleted, unavailable, unsupported and reset outcomes; duplicate/out-of-order delivery; retry and cursor advancement; the affected subgraph traversal and its stopping rules; and an idempotent update/review transaction. Decide the minimum on-demand behavior and interfaces preserved for scheduled/event-driven refresh. Detecting potential impact must not silently change belief or resolve a contradiction. Specify whether uncertainty flags conservative review when support remains available.

## Answer

Resolved by agent decision on 2026-09-10 under the user’s later instruction to continue until complete while away. This is not a claimed human answer to the earlier HITL question.

Use capability-based file provider with project-relative contained paths, retained UTF-8 observations and deterministic digest/state comparison. On-demand refresh distinguishes content change, missing, unavailable and restored. Commit observations/change/review together; traverse declared dependants conservatively and dedupe across restart/rebuild using durable state. Scheduled/webhook adapters remain extension points. See ADR 0003 and the contract.
