# MCP and CLI TDD evidence

Checked **2026-09-10**. This note records the executions made while adding the
MCP stdio adapter and its CLI entry points. It reports observed command results;
it does not manufacture a pre-implementation failure for a test that was not
run before the adapter was added.

## Compatibility prerequisite

The disposable SDK experiment was a compatibility probe rather than a
repository TDD cycle. With the pinned Node `24.21.0` executable, this command
ran the isolated client against the fixture server:

```text
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node client-smoke.mjs
```

The observed result negotiated modern `2026-07-28`, listed the fixture tools,
returned structured `{ "sum": 42 }` for `add({a: 2, b: 40})`, returned a
structured scoped success and `isError: true` for the unknown scope, worked
after a process restart, and returned legacy `2025-11-25` when legacy mode was
selected explicitly. The full command and evidence are in
[mcp-compatibility.md](mcp-compatibility.md). No red execution was recorded
for this disposable probe.

## Adapter cycles

All selected adapter runs used the real built CLI and the exact Node executable
above for the test runner:

```text
npm run build && /private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test test/mcp.test.ts
```

The first recorded run occurred after the initial adapter and four tests had
been added. It exited `0` with four passing tests:

- the MCP server lists every explicitly configured project;
- an unknown project returns a structured scope error before runtime dispatch;
- CLI `run` reports malformed JSON on stderr;
- CLI `mcp` requires at least one root.

No pre-implementation red run for those four tests was captured. The tests
were written against the agreed behavior and the first recorded execution was
already green.

The following incremental executions recorded these green results:

| Added behavior | Result |
| --- | --- |
| `knowledge_bases` and `create_kb` calls through the MCP server, with the real initialized project | The existing MCP test remained green; the run reported four passing tests. |
| Valid CLI `run` dispatch and JSON response | Exit `0`; five tests passed. |
| Uninitialized root rejection for CLI `mcp` | Exit `0`; six tests passed. |
| Missing request file handling for CLI `run` | Exit `0`; seven tests passed. |

The final seven-test selected run reported exit `0`, seven passed, zero failed,
zero skipped. The test names and results were:

```text
the MCP stdio server lists every explicitly configured project
MCP returns a structured scope error before dispatching an unknown project
the CLI run command reports malformed JSON on stderr
the CLI run command dispatches a valid operation and emits its JSON response
the CLI run command reports an unreadable request file as invalid input
the CLI mcp command requires at least one root
the CLI mcp command rejects an uninitialized project root
```

The MCP test was then expanded to assert the runtime `knowledge_bases` result
and `create_kb` mutation. Those assertions were part of the seven-test green
run; they did not create additional test cases.

## Regression and typecheck evidence

An intermediate full-suite command was run as:

```text
npm test
```

It built successfully and reported `21` tests with `20` passing and `1`
failing. The failure was the existing runtime test
`runtime rejects a history directory symlink without writing outside the
project`, with `AssertionError [ERR_ASSERTION]: Missing expected rejection` at
`test/runtime.test.ts:61:5`. This was a runtime regression outside the MCP
adapter. The later runtime fix made that test pass.

After the selected MCP run, the repository typecheck exposed a test-only
annotation error. The exact command and failure were:

```text
npm run typecheck
```

```text
test/mcp.test.ts(83,52): error TS2339: Property 'createdAt' does not exist on type '{ id: string; parent: string | null; }'.
```

The test response annotation was widened to include the asserted knowledge
base fields. The final verification command was:

```text
npm run typecheck && npm run test
```

It exited `0`: typecheck passed, the build passed, and the full suite reported
`24` tests passed, `0` failed, `0` skipped. The passing suite included all
seven MCP/CLI tests, the runtime symlink guard, and the export check.

## Deferred production coverage

The production adapter tests recorded here do not yet assert the complete
client matrix. Focused follow-up tests remain for production tool-schema
inspection, an actual current-protocol and legacy-protocol production client
negotiation, structured success and business-error results across the full
operation surface, and server restart followed by a scoped mutation/query or
refresh. The disposable SDK fixture already demonstrated those protocol
mechanics; they are intentionally deferred until the corresponding runtime
operations are complete.

The installed Codex CLI fixture smoke is separate evidence in
[codex-client-smoke.md](codex-client-smoke.md). Its negotiated protocol was not
instrumented, so this note does not infer one from that run.

