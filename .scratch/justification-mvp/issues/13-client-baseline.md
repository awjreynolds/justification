# Choose the MCP clients and compatibility baseline the MVP must support

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: open
Assignee:
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 03, 04

Prerequisites: [Verify current MCP and source-change contracts for a local runtime](03-mcp-provider-contracts.md); [Agree the smallest ADR demonstration that proves the product](04-mvp-proof.md)

## Question

Which actual MCP clients and minimum versions must run the first demonstration, and what legacy protocol support is required? The current researched specification is 2026-07-28, with substantial lifecycle changes; current documentation alone does not establish installed-client or released-SDK compatibility. Choose the bounded client matrix, local stdio expectation, installation experience and candidate SDKs worth testing, without prematurely committing the whole runtime to an untested stack. Use the research as factual input; the user decides which clients matter. This decision unblocks a throwaway compatibility check before final runtime/MCP schemas are accepted.
