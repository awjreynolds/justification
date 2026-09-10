# Init and discovery TDD slice

Implemented 2026-09-10 against the confirmed first-slice contract in
[`docs/planning/first-slice.md`](../planning/first-slice.md). The public runtime
seam is `initializeProject(root)` plus `discoverProjects(roots)`. The CLI wraps
those operations as `justification init [directory]` and
`justification projects <directory>...`.

Initialization creates `kb/shared` and a readable `justification.json` project
descriptor. The descriptor stores a generated project ID, display name, the
`justification.project` format marker, version `1`, and the shared KB ID
`shared`. Runtime results expose the persisted ID, display name, canonical
root, and canonical `kb/shared` root. Discovery reads only the roots supplied
by the caller; an explicit root without a descriptor is uninitialized and is
not recursively searched. Malformed or unsupported descriptors and broken
initialized structure produce typed `ProjectError` codes.

## Red/green evidence

The first test was run against a deliberate runtime stub and failed with
`Error: Project initialization is not implemented`. The minimal file-backed
implementation then made the test pass.

Subsequent behavior was added one test at a time:

| Behavior | Meaningful red result | Green result |
| --- | --- | --- |
| Malformed metadata | Expected `MALFORMED_METADATA`, received no error code | Typed parse/shape error |
| Unsupported metadata version | `Missing expected rejection` | Typed `UNSUPPORTED_METADATA` |
| Missing shared KB | `Missing expected rejection` | Typed `INVALID_STRUCTURE` |
| Broken shared KB path | Existing filesystem `EEXIST` escaped | Typed `INVALID_STRUCTURE` |
| CLI initialization | Missing `dist/cli.js` | JSON descriptor from the process CLI |
| Missing discovery root | Expected `INVALID_ROOT`, received filesystem `ENOENT` | Typed `INVALID_ROOT` |

The repeatability, explicit-scope, CLI `projects`, and invalid-request checks
were added as public regression tests and passed with the corresponding
minimal runtime/CLI paths already in place.

## Verification

The pinned local toolchain was used with
`PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH`:

- Node `v24.21.0` (`.nvmrc`)
- TypeScript `7.0.2`
- `@types/node` `24.13.4`
- `npm run typecheck` passed
- `npm run build` passed
- `npm test` passed: 11 tests, 11 passes
- `npm pack --dry-run --json` passed with `dist/cli.js` and `dist/index.js` in the package

The first packaging attempt was blocked by a root-owned global npm cache. The
successful packaging check used a task-local cache under `/private/tmp` and
left the global cache untouched. No graph, source retrieval, semantic
interpretation, OKF export, or MCP implementation is included in this slice.
