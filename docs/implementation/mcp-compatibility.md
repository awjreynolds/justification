# MCP TypeScript SDK compatibility

Checked: **2026-09-10**. This note records a disposable SDK/client experiment for the
MCP prerequisite. It does not select the complete Justification MCP surface and does
not claim that this fixture proves the complete Justification MCP surface. The
follow-up [installed Codex client smoke](codex-client-smoke.md) records a successful
Codex CLI fixture call using the real executable path and automatic approval review.

## Release and runtime facts

The public npm registry reported the following on 2026-09-10:

| Package | Requested/resolved version | `latest` tag | Declared Node engine |
| --- | --- | --- | --- |
| `@modelcontextprotocol/server` | `2.0.0` | `2.0.0` | `>=20` |
| `@modelcontextprotocol/client` | `2.0.0` | `2.0.0` | `>=20` |
| `zod` (direct schema dependency in the experiment) | `4.6.1` | `4.6.1` | not declared by this check |

The SDK v2 documentation calls `2.0.0` the stable release line and describes it as
implementing the MCP `2026-07-28` specification. The v2 packages replace the v1
monolithic `@modelcontextprotocol/sdk` package. The v2 migration guide moves
`StdioClientTransport` to `@modelcontextprotocol/client/stdio`; the v2 server guide
uses `McpServer` from `@modelcontextprotocol/server`, `serveStdio` from
`@modelcontextprotocol/server/stdio`, and Zod v4 schemas.

Sources checked:

- [MCP TypeScript SDK v2 documentation](https://ts.sdk.modelcontextprotocol.io/v2/)
- [`@modelcontextprotocol/server` on npm](https://www.npmjs.com/package/@modelcontextprotocol/server?activeTab=versions)
- [`@modelcontextprotocol/client` on npm](https://www.npmjs.com/package/@modelcontextprotocol/client?activeTab=versions)
- [TypeScript SDK v2 protocol versions](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md)
- [TypeScript SDK v1 to v2 migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
- [MCP versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)
- [MCP stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)
- [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

The experiment used `/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node`
(`v24.21.0`) and npm `11.19.0`. It installed from a task-local cache at
`/private/tmp/justification-mcp-compatibility/npm-cache` with `npm ci --ignore-scripts`
from a lockfile (`lockfileVersion: 3`). The resolved direct packages were exactly
`@modelcontextprotocol/server@2.0.0`, `@modelcontextprotocol/client@2.0.0`, and
`zod@4.6.1`; the SDK's runtime `@modelcontextprotocol/core` resolved to `2.0.0`.
The disposable files were `/private/tmp/justification-mcp-compatibility/fixture-server.mjs`
and `client-smoke.mjs`; they are not production implementation.
The repository's existing `tsconfig.json` already declares `types: ["node"]`, which
the server package README calls out for TypeScript 6+ because its declarations refer
to `Buffer`.

## Interfaces to use

For a local Node stdio server, the tested import and construction shape is:

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

serveStdio(() => {
  const server = new McpServer({ name: 'justification', version: '0.1.0' });
  server.registerTool(
    'operation',
    {
      description: '...',
      inputSchema: z.object({ /* fields */ }),
      outputSchema: z.object({ /* fields */ }),
    },
    async input => ({
      content: [{ type: 'text', text: JSON.stringify({ /* result */ }) }],
      structuredContent: { /* result */ },
    }),
  );
  return server;
});
```

For a Node client that launches that server:

```ts
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const client = new Client(
  { name: 'justification-client', version: '0.1.0' },
  { versionNegotiation: { mode: 'auto' } },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['/absolute/path/to/server.mjs'],
  stderr: 'pipe',
});
await client.connect(transport);
const { tools } = await client.listTools();
const result = await client.callTool({
  name: 'operation',
  arguments: { /* explicitly scoped arguments */ },
});
```

`StdioClientTransport` is Node-only and spawns the configured command. `McpServer`
accepts Standard Schema objects with JSON Schema conversion; Zod v4 is the direct
schema dependency used by the tested examples. The client exposes
`getProtocolEra()`, `getNegotiatedProtocolVersion()`, `getServerVersion()`,
`getDiscoverResult()`, `discover()`, `listTools()`, and `callTool()`.

The client defaults to `versionNegotiation: { mode: 'legacy' }`, which performs the
2025 `initialize` exchange. Set `{ mode: 'auto' }` to probe `server/discover` and
choose modern or legacy. Set `{ mode: { pin: '2026-07-28' } }` only when a modern
server is required; it fails when that revision is not advertised. The SDK's stdio
auto probe uses a disposable sibling process before starting the caller's transport.

## SDK client smoke evidence

The fixture server exposed two harmless tools:

- `add({ a, b })` returns an output-schema-validated `{ sum }` result.
- `project-summary({ project_id, kb_id })` returns data only for the fixture scope
  `demo/shared`; other scopes return an MCP tool result with `isError: true`.

The exact Node client smoke command was:

```text
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node client-smoke.mjs
```

Observed result from a clean `npm ci` install:

| Check | Observed result |
| --- | --- |
| `connect()` with `mode: 'auto'` | `protocolEra: "modern"`, negotiated `2026-07-28` |
| `getDiscoverResult()` | `supportedVersions: ["2026-07-28"]`, tools capability, `resultType: "complete"`, server identity in `_meta["io.modelcontextprotocol/serverInfo"]` |
| `listTools()` | `add` and `project-summary`, with the declared input/output JSON Schemas |
| `add({a: 2, b: 40})` | text content `{"sum":42}` and `structuredContent: { sum: 42 }` |
| Scoped success | `project-summary({project_id: "demo", kb_id: "shared"})` returned the fixture summary and structured content |
| Scoped business failure | unknown scope returned `isError: true` with a text diagnostic; the client call resolved to a result rather than throwing |
| Restart | after close, a new client and process (different PIDs) negotiated modern again and returned `add({a: 1, b: 1}) = 2` |
| Explicit legacy mode | `protocolEra: "legacy"`, negotiated `2025-11-25`; `listTools()` and `add({a: 20, b: 22})` returned successfully |

The server wrote no protocol-invalid stdout or stderr. This demonstrates the
published SDK server and SDK client talking over real newline-delimited stdio. It
does not demonstrate an auto fallback against a separate legacy-only implementation;
the fixture supported both eras and the legacy row explicitly selected legacy mode.

## Production lifecycle evidence

The repository's production adapter was then exercised with the same pinned SDK
client and the built `dist/cli.js` server by
`test/mcp-lifecycle.test.ts`. The test created two initialized project roots,
connected with `{ versionNegotiation: { mode: "legacy" } }`, and observed
`protocolEra: "legacy"` with negotiated `2025-11-25`. It listed both configured
projects, then ran a scoped ADR chain in the first project: a file source was
captured with an explicit source ID, a claim was justified by its retained
evidence, two explicit options fed a decision with an original basis, and an
artifact record was based on that decision. The test independently hashed the
source and artifact bytes, asserted the returned ancestry/provenance and usable
support from `why`, closed the client, restarted the server and client, and
asserted an identical `why` response at a fixed evaluation time.

The focused command exited `0` with one passing test:

```text
npm run build
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test test/mcp-lifecycle.test.ts
```

This was an immediately-green integration verification; no pre-implementation
red run is claimed and no MCP transport or schema change was needed.

## Installed Codex CLI check

The installed binary reported `codex-cli 0.153.4`. Its help confirms the relevant
non-interactive options: `codex exec [OPTIONS] [PROMPT]`, `--ephemeral`,
`--ignore-user-config`, `--skip-git-repo-check`, `-m/--model`, repeated `-c/--config`,
`-s/--sandbox`, and `--json`. The MCP help confirms stdio registration with
`codex mcp add <NAME> -- <COMMAND>...` and config keys under `mcp_servers.<name>`.

I ran the requested shape with a temporary MCP server override, exact model and
reasoning settings, and `-s read-only`:

```text
codex exec --ephemeral --ignore-user-config --skip-git-repo-check \
  -m gpt-5.6-luna -c 'model_reasoning_effort="max"' \
  -c 'mcp_servers.fixture={command="/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node",args=["/private/tmp/justification-mcp-compatibility/fixture-server.mjs"]}' \
  -s read-only --json --color never \
  --cd /private/tmp/justification-mcp-compatibility \
  'Use the MCP server named fixture. Call its add tool exactly once with a=2 and b=40. Do not use shell, filesystem, network, or any other tool. Return only the numeric sum from the MCP tool result.'
```

The first sandboxed attempt stopped before a turn because the CLI could not open its
existing state database read/write. A retry with the outer process permitted to open
that existing database completed with exit status 0, but emitted this exact runtime
failure on stderr:

```text
Code Mode is unavailable because failed to spawn code-mode host
/Users/awjre/.local/bin/codex-code-mode-host: host executable was not found.
Code mode will fail closed; enable `features.code_mode_host` and install
`codex-code-mode-host`.
```

Those first runs are retained as failure evidence for the symlinked executable and
the noninteractive approval policy. A follow-up using the real executable at
`/Applications/ChatGPT.app/Contents/Resources/codex` and `--approve-for-me` reached
the fixture and produced an observed `mcp_tool_call` for `add({a: 2, b: 40})`, with
structured `{ sum: 42 }` and an independent `2,40` marker. See the complete
[Codex client smoke record](codex-client-smoke.md). The Codex run did not instrument
its negotiated protocol version; this note does not infer it from the result. No
global config was changed and no secret or non-fixture data was supplied.

## Recommendation and limits

Pin the first production integration to:

```json
{
  "@modelcontextprotocol/client": "2.0.0",
  "@modelcontextprotocol/server": "2.0.0",
  "zod": "4.6.1"
}
```

Use the imports and `serveStdio`/`McpServer`/`Client`/`StdioClientTransport` shapes
above. Keep `versionNegotiation: { mode: 'auto' }` while the target client matrix is
open; expose the negotiated era and version in diagnostics. A production server
should require explicit `project_id` and KB arguments in each scoped tool, return
structured success data plus a text compatibility representation, and use
`isError: true` for business-rule or argument-value failures. Unknown tools and
malformed protocol requests remain JSON-RPC errors handled by the SDK.

This experiment does not decide the full runtime/MCP schema, authorization policy or
resource surface. It demonstrates the SDK client and the installed Codex CLI against
the fixture; production support still depends on the adapter tests and the CLI's
unmeasured negotiated version. Re-run it when the SDK, Node runtime, CLI build, or
version-negotiation policy changes.
