# Establish which Open Knowledge Format specification the MVP can target

Type: research
Label: wayfinder:research
Mode: AFK
Status: resolved
Assignee: awjreynolds
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by:

## Question

What authoritative Open Knowledge Format project, specification and version match the brief, and what compatibility can Justification truthfully promise? Find primary specifications and implementation evidence, distinguish similarly named projects, and document maturity, licensing, extensibility, identifiers, provenance, links, temporal state, Markdown/YAML expectations and round-trip limitations. Record unresolved identity/version ambiguity explicitly; do not invent an OKF schema. Recommend the narrowest testable compatibility boundary and questions the persistence decision must settle.

## Answer

Resolved 2026-09-10 by background research, claimed for awjreynolds.

The brief strongly matches Google Cloud’s Open Knowledge Format. The canonical project is now GoogleCloudPlatform/open-knowledge-format; the old knowledge-catalog/okf copy is frozen. README and specification identify v0.2 at inspected revision ad30107c31c06aec8a7d5636e0d1058118604e6f. No standalone machine-readable conformance schema was identified. This completes the factual investigation, not the choice of persistence architecture. The report recommends a pinned core-format target plus separately versioned Justification extensions; identity, bundle boundaries, durable authority and preservation guarantees remain open.

Evidence and limits: [Research findings](../../../docs/research/okf-compatibility.md).

Research context: `research/okf-compatibility`, commit `56b9614756216cad040226f38bed98bca6c91920`; the report is also incorporated into this checkout. No production implementation or interoperability certification was performed.
