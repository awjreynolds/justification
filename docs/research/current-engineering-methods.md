# Current engineering methods for Justification

Checked: **2026-09-10**. Scope: implementation workflow and future semantic evaluation. This is primary-source research, not a comparative experiment. It preserves the user-confirmed [runtime, CLI and MCP test seams](../planning/tdd-plan.md) and [bootstrap contract](../planning/first-slice.md). Node/TypeScript package verification is recorded separately in that contract.

## Finding and evidence strength

Continue with bounded behavioral TDD and a separate reviewer. Current guidance supports explicit success criteria, executable verification and review; it does **not** establish a universally best development method or model pairing. OpenAI recommends relevant tests/checks, confirmation against the requested behavior, and diff review before acceptance. Its review guidance allows a fixed commit or base-branch comparison. [OpenAI, Best practices](https://learn.chatgpt.com/guides/best-practices#improve-reliability-with-testing-and-review).

Anthropic likewise recommends runnable verification, evidence of commands/results, and a fresh writer/reviewer context; its examples include reproducing a bug with a failing test before fixing it. These are first-party practice recommendations, not controlled evidence that every project benefits equally. [Claude Code best practices](https://code.claude.com/docs/en/best-practices).

The stable methodological commitments here are observable outcomes, independent expected answers, reproducible checks and explicit evidence limits. The exact runtime/CLI/MCP boundaries, one-behavior red–green cycle and real-storage preference are **confirmed project choices**, not requirements imposed by either vendor. Current guidance supplies no reason to reopen them.

## Concrete improvements to the implementation loop

These are project recommendations applying the guidance above:

1. Give each Luna slice the agreed behavior, public interface, owned files, exclusions and completion checks. Keep the first slice limited to initialization/discovery; unresolved graph and semantic contracts do not enter through convenient implementation details.
2. Record the actual failing assertion, command, exit status and code revision, followed by the passing result. A broken runner, missing dependency or unrelated import error does not demonstrate the missing behavior. Expected discovery outcomes come from the contract, not private implementation helpers.
3. Keep regression checks proportional to the affected behavior. Runtime tests use temporary project files; CLI checks inspect actual output/status; MCP tests eventually exercise the agreed clients. Controlled external inputs and time belong at boundaries. A passing mock cannot establish external compatibility.
4. Give Astra the fixed base/head revisions, contract and raw verification evidence in a separate review context. Ask it to challenge both code and tests: omitted failure cases, expectations copied from implementation, scope leakage, persistence/reopening and accidental overwrite. “Independent” describes a separate review pass, not statistically independent model errors.
5. Return actionable findings to Luna; preserve the behavioral checks through refactoring and re-review material fixes. Record remaining limitations explicitly rather than interpreting zero findings as proof of correctness.

Retain **`gpt-5.6-luna`, `max` for implementation** and **`gpt-6-astra`, `medium` for review**. The opened model pages list these effort settings as supported and identify each current snapshot with its model ID. That verifies documented compatibility, not account availability or comparative effectiveness. Do not invent a dated snapshot or introduce either model as a runtime dependency. [Luna model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra).

## When semantic interpretation arrives

Keep deterministic domain guarantees executable without a live model. Add semantic evals at the first nondeterministic interpretation boundary; passing schema validation alone cannot show that a claim follows from its source.

OpenAI recommends task-specific objectives, representative datasets, defined metrics, continuous evaluation on changes, and human calibration of automated graders. It distinguishes ordinary, edge and adversarial cases and favors criterion-based classification or comparisons over unconstrained judging. This is methodological guidance, not a mandated product-specific threshold. [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

Anthropic recommends clean trial environments, grading outcomes rather than rigid tool sequences, and inspecting transcripts to identify unfair graders. It distinguishes success at least once across attempts (`pass@k`) from consistent success across all attempts (`pass^k`); these answer different reliability questions. Its reported infrastructure and grading failures show possible confounds, not their frequency in Justification. [Demystifying evals for AI agents, 2026-01-09](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

**Proposed Justification evaluation contract:** create reviewed source/claim fixtures with explicit accepted and rejected interpretations, including support, contradiction, insufficient evidence, changed wording without changed meaning, and unavailable evidence. Evaluate groundedness, evidence-pointer correctness, coverage and unjustified certainty separately. Include both changes that should create review work and changes that should not. Fix source snapshots and evaluation time; hold out cases from prompt tuning. Keep deterministic checks for identifiers, scope and durable state, with a human-calibrated rubric only where meaning requires judgment. Store per-case outputs and disagreements, not just one aggregate score. Decide pass thresholds and repeat counts before comparing candidates; report variation and the sample size. No specific threshold or winning semantic model is established yet.

One volatile warning is already concrete: OpenAI announced Evals platform deprecation on 2026-06-03; existing evals become read-only on 2026-10-31, and its dashboard/API are scheduled to shut down on 2026-11-30. Keep fixtures, rubrics and results provider-independent; select an actively supported harness when semantic work starts. This does not invalidate evaluation as a method. [OpenAI deprecation notice](https://developers.openai.com/api/docs/deprecations#2026-06-03-evals-platform).

## Evidence and refresh discipline

Use the following **project policy**, not an asserted industry standard:

| Evidence surface | Retain | Recheck trigger |
|---|---|---|
| Coding/review run | Code revision, contract/test revision, model ID, effective effort, harness/client build, commands/results and findings | Harness/model/effort change, regression or resumed work after an environment update |
| Semantic comparison | Above plus prompt/tool schema versions, corpus hashes, rubric/grader versions, settings and repeated trial outputs | Any behavior-affecting model, prompt, retrieval, tool, rubric or corpus change; newly observed failure |
| External guidance | Primary URL, checked date, relevant version/revision, supported claim and remaining uncertainty | Before depending on an API or contract; release/deprecation notice; conflicting evidence; changed source |
| Packages | Exact resolved versions, lockfile, actual execution environment and installation/typecheck results | Dependency/runtime upgrade or failed reproducibility check |

Reuse today's [MCP/provider research](mcp-provider-contracts.md) and [OKF compatibility research](okf-compatibility.md). Their inspected targets are MCP `2026-07-28` and OKF v0.2 at commit `ad30107c31c06aec8a7d5636e0d1058118604e6f`; this note did not independently repeat those checks. Recheck MCP when selecting/upgrading the SDK or target clients, and repeat actual-client compatibility tests. Recheck OKF before adopting a different source revision, importing unfamiliar bundles or expanding the export/preservation promise. An unchanged version label does not replace a pinned revision.

The unresolved evidence is project-specific: this workflow's cost, latency, escaped defects and reviewer yield have not been measured; semantic datasets, thresholds and harness remain undecided; installed-client MCP compatibility still requires its separate experiment. Record those outcomes before claiming improvement or changing the confirmed pairing.
