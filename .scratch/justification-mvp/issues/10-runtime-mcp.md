# Specify the runtime, CLI and bounded MCP contract

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: resolved
Assignee: awjreynolds
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 03, 07, 08, 09, 11, 14

Prerequisites: [Verify current MCP and source-change contracts for a local runtime](03-mcp-provider-contracts.md); [Choose durable authority and an honest OKF compatibility boundary](07-persistence-authority.md); [Define shared inheritance, explicit promotion and project isolation](08-scope-identity.md); [Define a deterministic provider and selective-refresh transaction](09-refresh-contract.md); [Choose artifact assertion anchors and acceptable drift behavior](11-artifact-contract.md); [Verify a pinned MCP SDK against the agreed client matrix](14-client-smoke.md)

## Question

What language, package/distribution shape and runtime boundaries best fit the settled MVP? Define CLI initialization and child-KB creation plus structured runtime operations for capture/link/decision/artifact writes, queries, refresh and review. The candidate MCP list lacks a complete ingestion/write path; settle a minimal coherent subset and its input/output/error schemas, with explicit project/KB routing, mutation permissions, pagination, graph limits and concurrent writers. Define context compilation as a deterministic, budget-bounded selection with provenance/conflict notices; do not promise a globally smallest trusted context or model-independent exact token counts without a tokenizer contract. Decide whether optional context/search conveniences can follow the first trace/impact slice.

## Answer

Resolved on 2026-09-10 under the user’s instruction to continue until complete. Routine contract choices are agent decisions; execution claims below have recorded tool evidence.

Use TypeScript on the pinned Node24 toolchain and one public executeOperation(root,request) dispatcher returning revision/data. CLI retains init/projects and adds run root request-file-or-stdin plus one mcp process over explicit roots. MCP exposes high-level operation tools with strict schemas and routes persisted project IDs only. Protocol compatibility is demonstrated by ticket14; exact runtime payloads are maintained in docs/implementation/runtime-api.md. Context uses a documented bounded representation, not a claim of globally minimal trusted context. See docs/planning/mvp-contract.md.
