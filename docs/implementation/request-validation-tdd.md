# Request validation TDD evidence

Checked **2026-09-10**. This note records the bounded request-validation
correction. It uses the pinned Zod `4.6.1` dependency already used by the MCP
adapter and the public runtime dispatcher. It does not claim a new operation or
change the runtime's semantic checks.

## Shared schema boundary

The operation request definitions now live in `src/requests.ts`. They omit the
transport-only MCP `project_id`; `src/mcp.ts` wraps each operation schema with
that required project selector before registering the tool. The runtime uses
the same operation schemas after removing only the `op` discriminator used to
select the schema. Every known operation is strict at the top level.

`record.fields` is a strict allowlist of caller-settable values: proposition
keys, explicit acceptance, artifact locators and expected digests, considered
and selected options, and a rationale. Runtime-created provenance and basis
metadata such as `sourceId`, `observationId`, `providerRevision`,
`observedText`, `observedBytesDigest`, `availability`,
`originalBasisJustificationId`, `recordedAtRevision`, `basis` and `basisGroups`
are rejected there. A record of an ordinary kind cannot supply top-level
`basis` or `basisGroups`; the error directs callers to `justify`, where support
is attributed and grouped. Decision and artifact records retain their existing
semantic requirement for a nonempty basis.

## Unknown top-level field: RED → GREEN

The first public test initializes a real temporary project, reads its revision,
passes `unsupportedField` to `knowledge_bases`, and then checks both the stable
`INVALID_REQUEST`/field diagnostic and unchanged revision/data.

Before the runtime entry hook, the focused command failed with the meaningful
behavioral result `Missing expected rejection`: the dispatcher silently ignored
the extra field. The command was:

```text
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test --test-name-pattern='unsupported top-level' test/validation.test.ts
```

The minimum correction imports `validateRuntimeRequest` and calls it at the
dispatcher boundary before loading or changing project state. The shared
schema strips only `op` for lookup, then applies the strict operation object;
the focused test passed with one test and zero failures.

## Computed/provenance fields: baseline sensitivity verification

The second public test attempts to record a claim with
`fields: { sourceId: "forged-source" }` and checks `INVALID_REQUEST`, a
diagnostic naming `sourceId`, and unchanged revision/data.

The allowlist had been prepared before this focused test. To verify that the
test is sensitive to the intended correction, the `record.fields` schema was
temporarily replaced with the former broad `z.record(z.string(), z.unknown())`
baseline. The focused test then failed with `Missing expected rejection`, since
the forged field was accepted and the claim committed. Restoring the strict
caller-field schema made both validation tests pass with two tests and zero
failures. This baseline sensitivity check is disclosed as verification; it is
not presented as a historical pre-implementation red run.

## Impossible calendar date: already-green verification

The installed runtime's existing `parseInstant` accepts
`2026-02-30T00:00:00Z` and normalizes it to `2026-03-02T00:00:00.000Z`:

```text
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --input-type=module -e 'import("./src/domain.ts").then(({parseInstant}) => console.log(parseInstant("2026-02-30T00:00:00Z", "applicability.validFrom")))'
2026-03-02T00:00:00.000Z
```

The shared timestamp refinement checks the calendar day before the runtime
normalizes it. The public test submits that impossible `validFrom` date for a
real temporary-project claim, expects `INVALID_REQUEST`, and confirms that the
revision/data remain unchanged. It passed immediately after the refinement was
prepared; no historical red run is claimed for this clause.

## Non-decision basis and final verification

The public validation set also verifies that a claim with a valid existing
premise and top-level `basis` is rejected with `INVALID_REQUEST` and guidance
to use `justify`, without advancing the revision. This rejection clause was
prepared ahead of its focused check, so it is recorded as already-green
verification rather than a fabricated red–green cycle.

The final focused checks were:

```text
npm run typecheck
npm run build
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test test/validation.test.ts
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test test/mcp.test.ts
/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node --test test/mcp-lifecycle.test.ts
```

All commands passed. The validation file reported four passing tests, the
existing MCP/CLI regression file reported ten passing tests, and the public
legacy lifecycle test reported one passing test. No dependency or protocol
version changed, and no MCP transport/schema workaround was needed beyond
sharing the operation definitions.
