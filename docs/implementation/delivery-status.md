# MVP delivery status

This note records bounded delivery work owned by the examples/documentation
slice. It is a coordination record, not a user answer or a new product
contract.

## Examples and docs

Commit `84959f8` makes a general research-output workflow the default demo.
`examples/knowledge-output-demo.mjs` captures two independent fictional sources,
records justified claims and an open question, writes a Markdown brief, and
records that artifact directly against its claims without inventing a decision.
Changing one source proves exact affected and unaffected sets and preserves
the historical explanation and original output file.

- Added the deterministic fictional checkout-cache ADR fixture in
  `examples/adr-fixture.md`.
- Added `examples/adr-demo.mjs`, which creates two safe isolated project roots,
  exercises the public runtime workflow, asserts historical/current explanation,
  changed-source impact, unchanged refresh idempotence, rebuild equivalence and
  project isolation, then prints JSON paths and IDs.
- Replaced the bootstrap-only README with build/install/runtime/CLI/MCP,
  native-backup and OKF limitation guidance.
- Added `docs/usage.md` for the public operation surface and
  `docs/recovery.md` for actual descriptor/history/projection/provider error
  handling.

Both `npm run demo` and `npm run demo:adr` passed against the public runtime,
including exact impact and review assertions. These are integration
verification, not retroactive test-first evidence. The worker also ran the
full then-current test suite (72 passing), typecheck and syntax checks.
Remaining runtime operations and final delivery checks are still tracked in
the acceptance evidence; passing examples do not establish full completion.

## Coordination

The implementation slice must keep `examples/adr-demo.mjs` runnable after
runtime response shapes settle. The CLI/MCP slice should preserve the commands
documented in README and `docs/usage.md` (`run` and `mcp`) or update those docs
with the observed interface before review. No package manifest changes are
needed for examples; the script imports the built public `dist/index.js`.
