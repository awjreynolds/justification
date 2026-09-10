# TDD plan

The user requested TDD after the initial Wayfinder chart and confirmed the runtime, CLI and MCP seams on 2026-09-10. The subsequent instruction to continue until complete authorizes the full MVP. TDD remains the implementation method; the [MVP contract](mvp-contract.md) records the routine design decisions made under that authorization.

## Confirmed test seams

| Public interface | Behaviors to observe |
| --- | --- |
| Runtime | Project/KB creation and discovery; capture and retrieval of knowledge; `why`, `impact`, refresh and explicit review; scoped inheritance/promotion; export/import and rebuild equivalence. Tests exercise public operations and documented outputs. |
| CLI | A small set of process-level checks for initialization, argument/configuration handling, useful output and exit status. Core graph scenarios remain covered through the runtime. |
| MCP | Version-compatible discovery, tool schemas, scoped calls, structured results/errors and restart using the agreed clients. Expand only as the corresponding runtime operation becomes available. |

Published Markdown/OKF exports are observable runtime outputs. Their eventual conformance tests should use the pinned external format contract. Database tables, private traversal functions, internal call counts and unexported serialization details are not test interfaces.

## First red–green cycle

**Behavior:** Initialising an empty project makes it discoverable with its shared knowledge base.

- Given an empty temporary directory selected as a project root;
- when a caller initialises the project through the public runtime interface;
- then public discovery reports that project and its `shared` KB.

The [first-slice contract](first-slice.md) specifies the minimum bootstrap behavior and metadata, leaving the full knowledge format open. The test must fail because that behavior is missing, not merely because a dependency or test runner is broken. Implement only enough to pass it.

## Subsequent candidate behaviors

Choose one behavior after the previous cycle passes and the relevant design decision is resolved. This is an ordered set of examples, not permission to write a complete test suite in advance.

1. A recorded decision can explain its support through a claim to a specific retained source observation.
2. A changed source makes its dependent decision/artifact visible for review while preserving the historical explanation.
3. Refreshing the same source state again does not create duplicate review work.
4. An unrelated project remains outside the result of a scoped query or refresh.
5. Rebuilding from durable state preserves the public explanation and review results at a fixed evaluation time.

Alternative support, applicability, promotion conflicts, artifact drift and remaining failure cases follow their resolved contracts. Expected paths and outcomes come from worked fixtures; tests must not recompute expected answers using the implementation's traversal logic.

## Implementation and review

- **gpt-5.6-luna, max** owns each bounded implementation slice: one agreed seam, one failing behavioral test, and the minimum change that makes it pass.
- Use actual temporary project files and the real storage implementation where practical. Control external provider responses and time at their interfaces; do not mock internal graph collaborators.
- Record the meaningful failing result and subsequent passing result for each cycle. Run relevant existing tests to detect regressions.
- **gpt-6-astra, medium** reviews the resulting diff, behavioral coverage and agreement with the resolved decisions. Return findings to Luna. Refactoring happens in this review stage; keep the behavioral tests passing and re-review material fixes.
- The actual-client MCP experiment remains the separate prerequisite recorded in the map. A mocked transport test cannot close that task.

## Confirmation status

**Confirmed by the user on 2026-09-10:** runtime, CLI and MCP as described above, starting with initialisation and discovery. Confirmation also requires checking current best-known methods against primary sources. Reuse this confirmation for work at these seams; ask only if a materially different test seam becomes necessary.
