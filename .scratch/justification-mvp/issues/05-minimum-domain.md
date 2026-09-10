# Define the minimum evidence and justification model

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: open
Assignee:
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 02, 04

Prerequisites: [Identify the minimum rigorous semantics for provenance and weakened support](02-justification-semantics.md); [Agree the smallest ADR demonstration that proves the product](04-mvp-proof.md)

## Question

What is the smallest schema that can explain the ADR without confusing authoritative sources, captured observations, claims, requirements, decisions and artifact assertions? Decide whether Evidence/SourceRevision and Requirements/Assertions need first-class MVP records or explicit typed forms; the short MVP list omits them although the acceptance scenario uses them. Define edge directions, edge meaning, justification groups for jointly required versus alternative evidence, stable identity and graph invariants. Explicitly define proposition applicability: the subject, version/environment and time interval a claim concerns, how missing applicability is represented, and when two claims overlap sufficiently for a contradiction allegation. Applicability is distinct from KB storage/visibility and from the time an observation was captured. Specify what `why` can assert and how it reports unsupported nodes, cycles and incomplete explanations without claiming a full truth-maintenance engine. Record only resolved domain language in CONTEXT.md.
