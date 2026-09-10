# Specify the runtime, CLI and bounded MCP contract

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: claimed
Assignee: awjreynolds
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 03, 07, 08, 09, 11, 14

Prerequisites: [Verify current MCP and source-change contracts for a local runtime](03-mcp-provider-contracts.md); [Choose durable authority and an honest OKF compatibility boundary](07-persistence-authority.md); [Define shared inheritance, explicit promotion and project isolation](08-scope-identity.md); [Define a deterministic provider and selective-refresh transaction](09-refresh-contract.md); [Choose artifact assertion anchors and acceptable drift behavior](11-artifact-contract.md); [Verify a pinned MCP SDK against the agreed client matrix](14-client-smoke.md)

## Question

What language, package/distribution shape and runtime boundaries best fit the settled MVP? Define CLI initialization and child-KB creation plus structured runtime operations for capture/link/decision/artifact writes, queries, refresh and review. The candidate MCP list lacks a complete ingestion/write path; settle a minimal coherent subset and its input/output/error schemas, with explicit project/KB routing, mutation permissions, pagination, graph limits and concurrent writers. Define context compilation as a deterministic, budget-bounded selection with provenance/conflict notices; do not promise a globally smallest trusted context or model-independent exact token counts without a tokenizer contract. Decide whether optional context/search conveniences can follow the first trace/impact slice.
