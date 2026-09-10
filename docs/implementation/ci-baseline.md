# CI action baseline

Checked **2026-09-10** against the official action repositories and release
pages. The workflow uses immutable commit pins while retaining the release tag
in a comment for review:

| Action | Stable release checked | Immutable commit |
| --- | --- | --- |
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` |

The release pages identify `v7.0.1` as the latest checkout release and
`v7.0.0` as the latest setup-node release at the check date. They report the
short commit prefixes `3d3c42e` and `8207627`, respectively, and mark the
releases as GitHub-verified/immutable. The full hashes above were independently
resolved from the corresponding annotated tag references with:

```sh
git ls-remote https://github.com/actions/checkout.git 'refs/tags/v7.0.1^{}'
git ls-remote https://github.com/actions/setup-node.git 'refs/tags/v7.0.0^{}'
```

Sources:

- [`actions/checkout` v7.0.1 release](https://github.com/actions/checkout/releases/tag/v7.0.1)
- [`actions/checkout` usage and v7 notes](https://github.com/actions/checkout/tree/v7.0.1#readme)
- [`actions/setup-node` v7.0.0 release](https://github.com/actions/setup-node/releases/tag/v7.0.0)
- [`actions/setup-node` usage and v7 notes](https://github.com/actions/setup-node/tree/v7.0.0#readme)
- [GitHub Actions workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)

## Compatibility choice

The repository pins Node `24.21.0` in `.nvmrc`. setup-node documents
`node-version-file` support for `.nvmrc`; the workflow uses that file rather
than duplicating the version. The action documentation describes v7 as an ESM
internal migration without changing action inputs or behavior. The checkout
documentation describes v7's safer handling of fork pull-request code. This
workflow runs only `push` and ordinary `pull_request` events, so it does not
use the privileged `pull_request_target` event.

The job runs on `ubuntu-latest` and executes `npm ci`, `npm run typecheck` and
`npm test`. `npm ci` consumes the committed lockfile. No dependency cache is
enabled, keeping the workflow limited to the verified actions and avoiding a
separate cache permission/configuration decision.

The top-level `permissions: contents: read` follows GitHub's least-privilege
workflow guidance. Declaring one permission sets unspecified token permissions
to `none`; this job has no need to write repository contents, checks, releases,
packages or other resources. Ubuntu is the only platform covered by this
baseline; no cross-platform behavior is claimed.

This note records release availability and documentation compatibility, plus
the first hosted runner result and its clean-checkout correction.

## Hosted typecheck correction

The first hosted run, [34535024675](https://github.com/awjreynolds/justification/actions/runs/34535024675),
ran on commit `84325838dced89fb23bf996432c631cf6c088494` and failed during
`npm run typecheck`, before the build step could create `dist/`. The fresh
checkout therefore exposed three related diagnostics:

```text
test/mcp.test.ts(12,24): error TS2307: Cannot find module '../dist/cli.js' or its corresponding type declarations.
test/mcp.test.ts(252,25): error TS7006: Parameter 'chunk' implicitly has an 'any' type.
test/mcp.test.ts(253,25): error TS7006: Parameter 'chunk' implicitly has an 'any' type.
```

The failure was reproduced locally from a clean archive of that commit. After
confirming `dist/` was absent, `npm ci` completed and this command exited `1`
with the same three diagnostics:

```sh
git archive 84325838dced89fb23bf996432c631cf6c088494 | tar -x -C "$tmp"
test ! -e "$tmp/dist"
(cd "$tmp" && npm ci)
(cd "$tmp" && PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH npm run typecheck)
```

The direct `runCli` API assertion in `test/mcp.test.ts` now imports from
`src/cli.ts`, and the CLI source import graph uses `.ts` extensions so Node's
test loader can resolve it before compilation. TypeScript rewrites those
extensions to `.js` in `dist/`; all process-level MCP and CLI tests continue to
start the actual built `dist/cli.js` executable.

The correction was then verified from a clean archive of `48cfca5` with the
three changed files applied and no pre-existing `dist/` directory. Under the
pinned Node `24.21.0` toolchain, the exact sequence below exited `0`:

```sh
test ! -e "$tmp/dist"
(cd "$tmp" && PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH npm ci)
(cd "$tmp" && PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH npm run typecheck)
(cd "$tmp" && PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH npm test)
```

Typecheck passed, the build created `dist/` as part of `npm test`, and all 54
tests passed, including the process-level MCP/CLI tests.

## Hosted verification after maintenance and recovery

Run [34539100562](https://github.com/awjreynolds/justification/actions/runs/34539100562)
completed successfully on commit `29fb7a5d1da3f7d3a5126f9847c3715a2d869287`.
The hosted clean checkout installed the pinned dependencies, passed typecheck,
built the executable and passed the 74-test suite. This closes the earlier
fresh-checkout failure and verifies source maintenance, recovery, and the real
MCP lifecycle on Ubuntu. Later knowledge-action and bounded-query work was
still in progress locally and was not part of this run.
