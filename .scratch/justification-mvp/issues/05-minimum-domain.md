# Define the minimum evidence and justification model

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: resolved
Assignee: awjreynolds
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 02, 04

Prerequisites: [Identify the minimum rigorous semantics for provenance and weakened support](02-justification-semantics.md); [Agree the smallest ADR demonstration that proves the product](04-mvp-proof.md)

## Question

What is the smallest schema that can explain the ADR without confusing authoritative sources, captured observations, claims, requirements, decisions and artifact assertions? Decide whether Evidence/SourceRevision and Requirements/Assertions need first-class MVP records or explicit typed forms; the short MVP list omits them although the acceptance scenario uses them. Define edge directions, edge meaning, justification groups for jointly required versus alternative evidence, stable identity and graph invariants. Explicitly define proposition applicability: the subject, version/environment and time interval a claim concerns, how missing applicability is represented, and when two claims overlap sufficiently for a contradiction allegation. Applicability is distinct from KB storage/visibility and from the time an observation was captured. Specify what `why` can assert and how it reports unsupported nodes, cycles and incomplete explanations without claiming a full truth-maintenance engine. Record only resolved domain language in CONTEXT.md.

## Answer

Resolved by agent decision on 2026-09-10 under the user’s later instruction to continue until complete while away. This is not a claimed human answer to the earlier HITL question.

Use immutable project-local node IDs, first-class retained evidence, a small shared node envelope and typed forms for constraints/options. Grouped premises are AND; groups are alternatives. Provenance links do not imply sufficient support. Explicit applicability is separate from KB visibility. Refuse support cycles and unknown/malformed input. Decisions/artifacts atomically retain explicit basis and acceptance revision. See the contract and ADR 0002.
