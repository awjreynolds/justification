# Find the route to a traceable Justification MVP

Label: wayfinder:map
Status: open

## Destination

An implementation-ready plan for a local-first, vendor-neutral MVP that proves an ADR can be traced to versioned evidence and flagged for review when its support changes. Resolve the model, persistence, provider and MCP contracts, identify revisions to the original brief, and define a staged implementation and verification route.

## Notes

- This effort charts and resolves planning decisions. After charting, the user invoked TDD and confirmed its public test seams and first init/discovery behavior. That bounded [first slice](../../docs/planning/first-slice.md) may proceed while broader domain and MCP decisions remain open; this is not blanket resolution of those decisions.
- Implementation: **gpt-5.6-luna, max** (the user's “Lunar Max”). Code review: **gpt-6-astra, medium**. Do not silently substitute models or lower their effort. Research is a separate role.
- The user confirmed the runtime, CLI and MCP test seams. Use one behavioral test and minimum implementation per red–green cycle under the [TDD plan](../../docs/planning/tdd-plan.md); reuse that confirmation rather than asking again.
- Before selecting or upgrading a volatile model, SDK, protocol or format dependency, check its current primary documentation, release status and actual compatibility. Record the check date, exact version/revision, evidence and limitations; newness alone is not a quality claim.
- Consult Wayfinder, Grilling and Domain Modeling when resolving decisions; use Research for external facts. A HITL ticket requires actual user input; recommendations are not resolutions. Charting resolves no non-research tickets, and subsequent sessions resolve at most one non-research ticket.
- Tracker: local Markdown, per the installed Wayfinder fallback. Each file in `issues/` is a child; `Blocked by` records dependencies. Claim by setting `Status: claimed` and `Assignee: awjreynolds` before work. Resolve by appending `## Answer` to the ticket, setting `Status: resolved`, and adding a linked gist here.
- Frontier: open, unassigned children whose blockers are resolved, sorted by filename. Open tickets are discovered from `issues/`, not duplicated in this index.
- Preserve the original scope: the product owns justification and provenance; providers remain authoritative. MIT/public repository; no application code exists at the start of this map.
- Context: [Original project brief](../../docs/planning/original-brief.txt), [Brief review and candidate route](../../docs/planning/brief-review.md). The review contains proposals, not accepted decisions. [Independent planning review](../../docs/planning/plan-review.md).

## Decisions so far

- [Establish which Open Knowledge Format specification the MVP can target](issues/01-okf-compatibility.md): Located the canonical v0.2 specification; Justification semantics and round-trip guarantees need an explicit profile.
- [Identify the minimum rigorous semantics for provenance and weakened support](issues/02-justification-semantics.md): Separated provenance, asserted support and potential impact; AND/alternative support and applicability need explicit rules.
- [Verify current MCP and source-change contracts for a local runtime](issues/03-mcp-provider-contracts.md): Verified current protocol and change-signal contracts; actual client/SDK compatibility requires a separate check.
- [Verify current engineering and AI evaluation methods before implementation](issues/15-current-methods.md): Current guidance supports executable evidence and separate review; volatile integrations need dated version and compatibility checks.

## Not yet specified

- Exact module seams and package layout after the minimum schema, storage authority and transport contracts are settled.
- Additional adversarial fixtures needed after support, promotion and review rules become concrete.
- Migration and compatibility fixtures after a precise OKF version and extension strategy are identified.
- The content and packaging of the optional agent skill once runtime operations are stable.

## Out of scope

- Building the whole application as part of charting. The subsequently confirmed init/discovery slice is a bounded exception recorded in Notes.
- Full ATMS, PROV, SACM, IBIS/QOC or OSLC implementations; their useful concepts may inform the MVP.
- UI, SaaS hosting, vector search, automatic contradiction adjudication, full code indexing, and replacing source systems.
- Production adapters for every listed provider, rich document sentence anchoring, and autonomous semantic refresh across arbitrary corpora. The MVP must preserve an extension path without implementing these now.
