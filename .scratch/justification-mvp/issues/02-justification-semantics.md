# Identify the minimum rigorous semantics for provenance and weakened support

Type: research
Label: wayfinder:research
Mode: AFK
Status: resolved
Assignee: awjreynolds
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by:

## Question

Which concepts from W3C PROV, truth maintenance/ATMS, SACM, IBIS/QOC and federated traceability materially improve this MVP? Use primary sources to distinguish observation, evidence, claim, argument, inference and contradiction; explain AND versus alternative support, retraction versus falsehood, temporal provenance and historical decisions. Recommend a small conservative model with explicit non-goals. This is research to inform a decision, not authority to lock the ontology or implement a reasoner.

## Answer

Resolved 2026-09-10 by background research, claimed for awjreynolds.

Primary sources distinguish provenance from an asserted argument for support. TMS/ATMS offers conjunctive premise groups and alternative justifications; PROV supports attributed/versioned provenance; SACM separates claims, evidence references and reasoning. Source changes identify potential impact without establishing falsehood. The report recommends retained observations, historical rationale, separate freshness/support/review dimensions and visible contradictions. These are inputs to the minimum-domain and state decisions, not an accepted ontology or authority to implement a full reasoner.

Evidence and limits: [Research findings](../../../docs/research/justification-semantics.md).

Research context: `research/justification-semantics`, commit `76dee80338d9f2897b50ac732fb8f8d64f5171c4`; the report is also incorporated into this checkout. No production implementation or interoperability certification was performed.
