# Verify current MCP and source-change contracts for a local runtime

Type: research
Label: wayfinder:research
Mode: AFK
Status: resolved
Assignee: awjreynolds
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by:

## Question

What do current official MCP specifications/SDKs and HTTP/Git/file change mechanisms actually guarantee for this MVP? Verify tools versus resources, local stdio operation, structured tool results and errors, capability discovery, multi-project routing, and relevant security boundaries. Compare a file provider with a small HTTP provider for the ADR demonstration, including validators, unavailable/deleted sources, cursor reset, content hashing and source identity. Separate standards from recommendations and never equate a changed validator with a changed meaning. Give a bounded recommendation for the first provider and MCP surface without selecting an implementation language for the user.

## Answer

Resolved 2026-09-10 by background research, claimed for awjreynolds.

The current official MCP specification is 2026-07-28 and changes lifecycle/discovery behavior; installed-client and released-SDK compatibility was not demonstrated. Standards support one scoped stdio server but do not supply project isolation or runtime semantics. File/HTTP/Git change signals concern observed representation/revision, not meaning or truth. The report recommends explicit project routing, capability-based adapters and normalized change/failure outcomes, with a file provider as a candidate first adapter. Target-client selection and a pinned SDK smoke check are now separate prerequisites; the provider choice remains open.

Evidence and limits: [Research findings](../../../docs/research/mcp-provider-contracts.md).

Research context: `research/mcp-provider-contracts`, commit `8fabc008daf5d0d498415aa825382863b02d112c`; the report is also incorporated into this checkout. No production implementation or interoperability certification was performed.
