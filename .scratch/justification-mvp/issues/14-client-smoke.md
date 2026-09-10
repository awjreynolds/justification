# Verify a pinned MCP SDK against the agreed client matrix

Type: task
Label: wayfinder:task
Mode: AFK
Status: open
Assignee:
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 13

Prerequisites: [Choose the MCP clients and compatibility baseline the MVP must support](13-client-baseline.md)

## Question

Run the minimum throwaway compatibility check needed to decide the MVP's MCP contract: a pinned candidate SDK, actual agreed client builds, stdio discovery/negotiation, tools/list, one explicitly scoped call, structured success/error and process restart. Record client build, SDK release, protocol version and observed failures; do not claim success from a mock client alone. If agreed clients are unavailable, record the precise missing setup and leave this task unresolved. Any scratch implementation uses gpt-5.6-luna at max; gpt-6-astra at medium reviews the results and any retained code. Link the disposable experiment and evidence from the answer; it is not a production runtime. Resolve only when the agreed matrix has evidence sufficient for the subsequent runtime decision.
