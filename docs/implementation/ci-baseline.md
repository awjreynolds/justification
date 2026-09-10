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

This note records release availability and documentation compatibility, not a
completed hosted GitHub run. The parent task should inspect the first run after
publishing the workflow and record any runner-specific failure separately.
