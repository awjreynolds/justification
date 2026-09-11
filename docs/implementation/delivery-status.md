# MVP delivery status

The resolved MVP is implemented, reviewed and available in the public
repository. [Acceptance evidence](acceptance.md) accounts for the original
eighteen requirements and the general knowledge/output clarification.

The runtime provides durable source/evidence capture, attributed knowledge,
grouped support, historical explanations, dependency impact, bounded queries,
source/artifact maintenance, explicit conflicts and review closure, shared
inheritance and promotion, audit, readable OKF export and deterministic native
recovery. The CLI and multi-project MCP server share that semantic boundary.

`npm run demo` runs the fictional research-output workflow without requiring
a decision. `npm run demo:adr` runs the original decision/ADR acceptance
scenario. Both passed from the repository and from a clean installed package.
Public usage, native backup/recovery guidance and an optional agent skill are
included.

Implementation commit `f13f01f` passes typecheck and 101 tests locally and in
hosted CI. Independent Standards/Spec review is complete and its last finding
is closed. See [final review](final-review.md),
[package verification](release-verification.md) and [CI evidence](ci-baseline.md).
The initial test-first process deviation remains explicitly documented.
