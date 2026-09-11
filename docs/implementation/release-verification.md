# Package and delivery verification

Verified on 2026-09-11 using Node v24.21.0 and implementation commit `f13f01f`.
The parent ran typecheck and all 101 tests, including actual SDK stdio
lifecycles. The final code also passed hosted Ubuntu CI, recorded in
[CI evidence](ci-baseline.md). Independent review is recorded in
[final review](final-review.md).

The build was packed with `npm pack` and installed into a fresh temporary
consumer directory. This installed the package and its production dependencies
without a symlink to the repository's `node_modules`. A
task-specific npm cache avoided modifying the machine's existing cache. The
first dependency fetch needed network access; the final fresh consumer install
then succeeded offline from those downloaded dependencies.

Verification exercised:

- Package-name imports of `executeOperation` and `discoverProjects`.
- The installed `justification` binary for initialization and JSON operations.
- The installed general example, which writes a research brief supported
  directly by claims, changes one source and checks exact impact/review scope
  and the unchanged historical explanation.
- The installed ADR example, including a second isolated project, explicit
  decision basis, source refresh, unchanged-refresh deduplication and rebuild.
- Tarball contents, including the compiled executable/modules and declarations,
  both example fixtures/scripts, public documentation and optional agent skill.

All checks passed. The package was tested locally; no npm registry publication
was part of the authorized delivery. The public Git repository contains the
source, lockfile, build commands, examples and verification records.

The initial runtime/transport scaffolding preceded meaningful failing tests.
Later regressions, vertical slices, integration verification and independent
reviews are recorded separately; see [runtime TDD evidence](runtime-tdd.md)
and [MCP TDD evidence](mcp-tdd.md).
