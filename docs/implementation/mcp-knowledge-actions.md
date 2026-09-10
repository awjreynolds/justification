# MCP knowledge-actions lifecycle evidence

Checked **2026-09-11** with the pinned Node `24.21.0` executable, the built
`dist/cli.js` server, and `@modelcontextprotocol/client@2.0.0`. The SDK release
and protocol compatibility facts were checked in the prior
[MCP compatibility note](mcp-compatibility.md) and are reused here unchanged;
this test is a production adapter verification, not a new dependency choice.
It is an immediately-green integration check, so no historical test-first red
run is claimed.

The test starts one real stdio server over two independently initialized
temporary projects. It creates child KBs `adr` and `research`, records fixed-ID
shared and child nodes in the first project and independent fixed-ID nodes in
the second, then connects with SDK automatic negotiation. The client observes
modern MCP `2026-07-28` and checks that the advertised schemas include the
`project_id` routing field and the action/query fields for `contradict`,
`conflicts`, `review`, `resolve_conflict`, `context` and `trace`.

In the first project's `adr` KB, a child-scoped contradiction joins an
inherited shared claim to a local claim. The MCP responses preserve the exact
fixed endpoint IDs, child ownership and open status, while shared and second
project conflict/review queries remain empty. A context query rooted at a local
artifact returns the exact local-to-shared support chain and its open dispute
and review flags. An upstream trace returns the exact inclusive paths and
declared-basis reasons without including the other project's nodes.

Both read queries are exercised with explicit budgets. The full responses fit
their requested UTF-8 envelopes, and smaller fixed budgets return deterministic
truncated prefixes that remain within the envelope and contain only candidates
from the corresponding full result. The second project's trace separately
returns only its own claim path.

The local contradiction review is closed through the MCP `review` mutation with
an explicit timestamp, actor, rationale and expected revision. A retry with the
same actor/rationale and expected revision omits `at`; it returns the same
revision with `committed: false`, `idempotent: true`, the original `closedAt`
and one closure-history entry. A subsequent `resolve_conflict` call uses an
explicit `winnerId` naming the local endpoint and records a resolved
`supersession` with its attributed resolution history. Final child conflict and
closed-review reads preserve the exact IDs/statuses, while shared and second
project reads remain empty. Revision assertions verify every mutation advance,
the omitted-at retry no-op, and read-only stability.

The final focused verification commands were:

```sh
npm run typecheck
npm run build
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  node --test test/mcp-knowledge-actions.test.ts
```

Typecheck and build exited `0`; the focused test reported `1` pass, `0` failed
and `0` skipped. No production defect was observed in this integration slice.
Temporary projects and the stdio client are cleaned up by the test.
