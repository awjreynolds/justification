# Working on Justification

Read `CONTEXT.md` for domain language. The decision map is `.scratch/justification-mvp/map.md`; unresolved decisions remain proposals. User instructions define current scope, including independently authorized slices such as `docs/planning/first-slice.md`.

## Implementation and review

Use **gpt-5.6-luna at max** for implementation and **gpt-6-astra at medium** for code reviews. Preserve these explicit user choices; disclose unavailable configurations instead of substituting them.

Before writing tests, read `docs/planning/tdd-plan.md`. The user has already confirmed runtime, CLI and MCP test seams. Work one behavioral test through observed failure and minimum passing implementation at a time, then review. Test public outcomes with independent expected values and realistic temporary project data. Record red/green evidence for each slice; reviewers check both the intended behavior and test quality. Keep refactoring in the review stage.

## Current methods

Before adopting or upgrading a model configuration, SDK, protocol, format or toolchain, verify relevant primary documentation and release/deprecation status. Record the check date, exact version/revision, source links and practical compatibility evidence in the relevant research or implementation note. Recheck when beginning the affected integration or changing a dependency; reuse unchanged verified facts within the same slice.

Distinguish documented support, available releases and demonstrated behavior. Select supported stable releases for the intended use, and pin dependency resolutions in the lockfile. Treat a newer method as a candidate to validate against this project's needs.

Use deterministic tests for runtime semantics. When semantic interpretation is introduced, add provider-independent evaluation fixtures and explicit quality criteria, keeping those results separate from deterministic test results. Consult `docs/research/current-engineering-methods.md` before choosing an evaluation harness or changing the agent workflow.
