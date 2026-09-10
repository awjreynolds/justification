# MCP maintenance lifecycle evidence

Checked **2026-09-10** with the pinned Node `24.21.0` executable, the built
`dist/cli.js` server and `@modelcontextprotocol/client@2.0.0`. The SDK and
protocol facts are recorded in [MCP compatibility](mcp-compatibility.md); this
note records the production maintenance lifecycle exercised by the current SDK
client. It is an immediately-green integration verification, so no historical
pre-implementation red run is claimed.

The focused test uses two independently initialized temporary project roots and
connects one real `StdioClientTransport` to the production CLI with automatic
version negotiation. It observes modern MCP `2026-07-28`, discovers both
configured projects, creates a research KB, captures a real Markdown source,
records a claim justified by retained evidence, and records a generic research
artifact whose basis points directly to that claim. Independently computed
SHA-256 digests and fixed timestamps verify the captured and artifact content.

The test then changes the source and calls `refresh` for the exact source ID.
The response reports one new observation, one content change and three open
dependent reviews. A public `inspect_source` call then resolves the new
evidence ID by matching its source, the refresh observation ID and the changed
digest. The `impact` query returns the exact affected evidence, claim and
artifact IDs, their expected paths, the change and the same review set, using
that independently selected ID rather than inferring it from the impact
response itself. The second refresh at the changed source state returns
the unchanged revision with
no new observations, changes or reviews. `why` at a fixed evaluation time
reports pending current support after the change while its historical response
at revision `5` remains usable and retains the original observation, basis and
provenance.

The same client attempts to query the artifact through the second project. The
server returns a structured `NOT_FOUND` result, and a before/after KB query
confirms that the second project's state is unchanged. After closing the client,
the test removes both disposable `.justification` directories and verifies that
they are gone. A fresh client/server pair rebuilds both projects from native
history; the current and historical `why` responses and the review response
deep-compare with the pre-restart values.

An earlier working-tree run reported a passing typecheck, build and focused test
before the final `impact` assertion was added. An isolated archive check of the
committed `2e06bb2` then found a typecheck error at that assertion: the response
annotation omitted the asserted evidence node's `kind` field. That result means
the earlier pass did not cover the committed final assertion. The correction
only widens the test response type; it does not change runtime behavior or test
semantics.

The final focused verification was:

```sh
npm run typecheck
npm run build
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  node --test test/mcp-maintenance.test.ts
```

Observed result after the correction: typecheck and build exited `0`; the
maintenance test exited `0` with `1` passing test, `0` failures and `0` skips.
The test is included in
the package's `test/*.test.ts` glob for the next full-suite run. The temporary
projects, server processes and disposable history are cleaned up by the test.

This check demonstrates the current SDK client's modern negotiation and the
production adapter's persistence, scope isolation, refresh, impact, review and
rebuild behavior. It does not claim semantic entailment, external provider
freshness beyond the file provider, or compatibility with an uninstrumented
third-party client; the installed Codex client evidence is recorded separately
in [codex-client-smoke](codex-client-smoke.md).
