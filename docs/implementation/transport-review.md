# CLI and MCP transport review

Two independent gpt-6-astra agents at medium reviewed `git diff 65b1dab...e006c23` on 2026-09-10. The scope covers implemented transport routing, schemas, errors, stdio behavior and the delivery harness. Future runtime operations and the pending full ADR demonstration are excluded from missing-feature findings at this stage.

## Standards

- **P2 — Initial adapter work was not test-first.** `mcp-tdd.md` accurately records the missing pre-implementation reds. Retain this deviation once; subsequent cycles must follow the requested sequence and independent verification.
- **P2 — MCP test cleanup only ran on successful paths.** Connection/assertion failure could leave a child process alive and make a useful regression hang. Register cleanup before connecting and close in `finally`.
- **P2 — A timestamp expectation copied the returned timestamp.** Use a fixed input timestamp and an independent expected value.

The reviewer also requested correcting the README's unsupported chosen-output-directory claim and the compatibility note's stale statement that production modern negotiation had not been asserted. CI release pins and their dated primary-source evidence were consistent; hosted CI execution remained pending. No additional actionable smell findings were reported.

## Spec

- **P2 — CLI stdin corrupted split UTF-8 characters.** Independent reproduction split `é` across input buffers and persisted `Caf��`. Decode the complete buffer or use a streaming decoder, with a process-level regression.
- **P2 — MCP omitted the runtime's export repair field.** Its strict schema rejected `repair: true` before dispatch. Expose the field and verify a real repair call through the client.

Configured-project routing uses a fixed ID-to-root map and rejects unknown IDs before dispatch. The reviewer found success/error payloads and stdout protocol separation consistent with the inspected contract.

All findings were accepted and assigned to Luna as sequential regression fixes. The pre-test process deviation cannot be repaired retrospectively. Production graph workflow, complete schema/legacy/restart coverage and installed-client calls against the finished server remain final integration work.

## Correction review

The Spec reviewer found no remaining material issue after `43448ab`. The
Standards reviewer requested one further test-quality correction: a 250 ms
delay between process writes did not guarantee that the first chunk had been
consumed. Commit `a104b70` added a deterministic test through public
`runCli` input, while retaining the process smoke with an explicit timing
limitation. An old-decoder sensitivity check was labelled as such, not a
retroactive red. Final Standards re-review of `43448ab...a104b70` reported no
actionable findings and no new hard process violation.

Installed Codex calls against the production server have now observed both
configured projects and each scoped shared KB; see the separate
[client evidence](codex-client-smoke.md). Full production graph lifecycle and
restart verification remain integration work.
