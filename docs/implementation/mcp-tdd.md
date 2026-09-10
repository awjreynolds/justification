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

## Sequential follow-up fixes

The next TDD cycle added one process-level stdin behavior: a JSON request
containing `Café` was sent to the CLI in two writes, with the second byte of
`é` delayed by 250 ms after the first write. The red command was:

```text
npm run build && /private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test test/mcp.test.ts
```

It exited `1`: eight tests ran, seven passed and the new test failed because
the CLI produced `knowledge base not found: Caf��` while the independent
expected message was `knowledge base not found: Café`. The minimum fix kept
stdin chunks as buffers until concatenation and one final UTF-8 decode. The
same command then exited `0` with eight passing tests. Because this smoke test
depends on process startup and scheduling to preserve the delayed read, the
250 ms red result is observational evidence rather than a deterministic TDD
failure.

The deterministic regression now invokes the public `runCli` export from the
compiled CLI with a supplied `CliIO.stdin` async iterable. It yields the same
request as two `Uint8Array` chunks split inside the UTF-8 encoding of `é`, then
asserts the public exit status and `NOT_FOUND` error containing the independent
expected value `Café`. With the buffer-preserving decoder restored, this focused
command exited `0` with one passing test:

```text
npm run build
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test --test-name-pattern='runCli decodes UTF-8 split across supplied stdin chunks' test/mcp.test.ts
```

As a sensitivity check, temporarily replacing the implementation with the old
per-chunk UTF-8 decoding made that same focused test fail deterministically:
the actual message contained `Caf��` while the expected message contained
`Café`. The buffer-preserving implementation was restored before the final
verification; this sensitivity check is not presented as a historical red run.

The following cycle added a meaningful MCP repair scenario: export a project,
modify its generated `kb/index.md`, then call `export` with `repair: true` and
assert that the original generated bytes are restored. Before the schema fix,
the same command exited `1`: nine tests ran, eight passed and the repair test
observed `isError: true` where a successful repaired result was expected. The
failure was strict MCP input validation rejecting the unadvertised `repair`
field. Adding the optional boolean to the `export` schema was the minimum fix;
the command then exited `0` with nine passing tests and the modified projection
was repaired.

The client cleanup changes moved `close()` into `finally` blocks so a failed
connect or assertion still closes a client, and the `create_kb` test now sends
the fixed timestamp `2026-01-01T00:00:00.000Z` and checks that exact independent
value. These quality changes had no separate red run. The final focused
verification after these changes was:

```text
npm run typecheck && npm run build && /private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test test/mcp.test.ts
```

It exited `0`; typecheck and build passed, and all ten MCP/CLI tests passed.

## Production lifecycle verification

An immediately-green SDK-client integration test now exercises the implemented
ADR chain over the real production stdio server. It configures two initialized
projects, explicitly negotiates legacy MCP `2025-11-25`, and uses fixed fixture
IDs and independently computed SHA-256 digests while calling
`capture_source` → `record` claim → `justify` → `record` options and decision →
`record` artifact → `why`. The test asserts the decision's basis and selected
options, the artifact's digest and original basis, the complete upstream
ancestry and retained source provenance, then closes the client, starts a fresh
server/client pair, and asserts an identical `why` response at the fixed
evaluation time.

This is verification of the already implemented public surface; no historical
red run is claimed for this integration test. The focused command exited `0`
with one passing test:

```text
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test test/mcp-lifecycle.test.ts
```

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
`24` tests passed, `0` failed, `0` skipped. The passing suite included the
MCP/CLI tests present at that point, the runtime symlink guard, and the export
check.

## Deferred production coverage

The production adapter tests recorded here assert modern negotiation
(`2026-07-28`) for the existing smoke and explicit legacy negotiation
(`2025-11-25`) for the ADR lifecycle. Focused follow-up tests remain for
structured success and business-error results across the full operation
surface, and server restart followed by a scoped mutation/query or refresh.
The disposable SDK fixture already demonstrated those protocol mechanics; the
remaining cases are deferred until the corresponding runtime operations are
complete.

The installed Codex CLI fixture smoke is separate evidence in
[codex-client-smoke.md](codex-client-smoke.md). Its negotiated protocol was not
instrumented, so this note does not infer one from that run.
