# MVP delivery status

This note records bounded delivery work owned by the examples/documentation
slice. It is a coordination record, not a user answer or a new product
contract.

## Examples and docs

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

The demo currently follows `docs/implementation/runtime-api.md` and waits for
the runtime implementation to settle its concrete response payloads. Run
`node --check examples/adr-demo.mjs` now; run the full demo after the runtime
and CLI slices are green. If response field names differ, update only the demo
extractors/assertions to match observed public results.

## Coordination

The implementation slice must keep `examples/adr-demo.mjs` runnable after
runtime response shapes settle. The CLI/MCP slice should preserve the commands
documented in README and `docs/usage.md` (`run` and `mcp`) or update those docs
with the observed interface before review. No package manifest changes are
needed for examples; the script imports the built public `dist/index.js`.
