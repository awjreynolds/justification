# Define shared inheritance, explicit promotion and project isolation

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: resolved
Assignee: awjreynolds
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 05

Prerequisites: [Define the minimum evidence and justification model](05-minimum-domain.md)

## Question

How are project, KB and node identities resolved across `kb/shared` and child KBs? Define whether only one shared-to-child level exists initially, what inheritance means for visibility versus support, how conflicting scoped claims coexist, and how references behave after rename, move, promotion and supersession. Inheriting visibility must not broaden a proposition's subject/version/time applicability, whose representation belongs to the minimum-domain decision. Include a fixture where production-v1 knowledge is visible to a v2 experiment but does not automatically justify its claims. Promotion must be explicit and must preserve lineage without duplicating shared content or silently overwriting it. Set discovery roots and cross-project read/write boundaries for one runtime; decide whether cross-project justification is prohibited or an explicit external reference in the MVP. Clarify whether scope affects relevance, access, or both.

## Answer

Resolved by agent decision on 2026-09-10 under the user’s later instruction to continue until complete while away. This is not a claimed human answer to the earlier HITL question.

Use one shared-to-child inheritance level and immutable IDs. Children can reference themselves/shared, never siblings; no cross-project graph links. Visibility never broadens applicability. Promotion is explicit, identity-preserving and requires shared upstream dependencies; identified conflicts create review instead of overwrite. See ADR 0003.
