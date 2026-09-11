# Final MVP review

Independent GPT-6 Astra reviewers at medium reviewed fixed
`7ac5c22...be8a61d`. The reviewed package adds promotion, persistent promotion
conflict gates, shared review ownership, child-index maintenance history,
history-authenticated projection cleanup, durable artifact transitions and
the real MCP knowledge-actions lifecycle. The parent ran typecheck and all
100 tests successfully; both worked examples also passed.

## Standards

No actionable findings. The reviewer checked public behavioral oracles,
independent IDs/paths/states, honest red/green evidence, optional state fields
for older native snapshots, common review-scope logic and documented reuse of
unchanged SDK/toolchain verification. This was a code/documentation review;
the reviewer did not claim an additional test run.

## Spec

One reproduced P2: capture a file in a child, promote only the source node,
then capture the unchanged locator in shared. The unchanged capture returns
the child-owned evidence node, although scoped evidence inspection correctly
omits it. Returned evidence must honor the effective capture scope without
changing revision or implicitly promoting that evidence.

At review time, correction was in progress through a public regression for
shared and sibling captures between source and evidence promotion. No other
actionable finding was established in that range.

The parent separately found and corrected a persisted promotion gate before
this review: omitting the optional conflict list on a retry could bypass the
open review recorded by the first request. The public regression now preserves
the pending review and child scope until explicit closure, then permits an
omitted-list retry. The observed failure and correction are recorded in
[promotion TDD evidence](promotion-tdd.md).

## Follow-up correction

The reproduced capture-scope P2 is corrected through the public runtime seam.
After a child source is promoted while its evidence remains child-owned,
unchanged captures from `shared` and a sibling now omit that evidence and keep
the source/observation visible. Both captures remain no-op responses at the
same revision. A changed capture still follows the transaction path, and the
retained evidence remains a separate promotion action. The focused regression
and typecheck pass (`8` promotion tests, `0` failures). The correction and its
observed RED/GREEN evidence are recorded in
[promotion TDD evidence](promotion-tdd.md); this follow-up does not claim a
new independent Astra review.

The parent separately ran typecheck and the full suite after this correction:
101 tests passed, with no failures. Independent Spec re-review of `f13f01f`
closed the finding: shared/sibling captures omit child evidence without a
commit, child access remains valid, separate evidence promotion exposes it,
and changed capture passes. No actionable finding remains in this gate.
