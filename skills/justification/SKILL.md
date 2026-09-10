---
name: justification
description: Maintain traceable project knowledge with a Justification runtime or MCP server. Use when capturing evidence, explaining decisions, tracing artifact dependencies, or reviewing changed support in an initialized Justification project.
---

# Justification

Use the runtime's advertised operation schemas through MCP, or its `run` CLI, to maintain knowledge. The runtime owns graph validation, durable history, scope and deterministic refresh. Provider systems remain authoritative for their own observations.

## Establish context

Discover configured projects and select the intended project and KB explicitly. Search the child KB and inherited shared knowledge before new research. Inspect provenance, applicability, current support and unresolved reviews before reusing a result. Shared visibility does not make a production-v1 claim applicable to a v2 experiment.

Use bounded `context` results as an index into the graph. Follow evidence and `why` when the task depends on a consequential claim; a short excerpt alone may omit an important qualification.

## Capture and justify

Capture an authoritative source observation before recording an interpretation of it. Keep the observed text/revision separate from the claim it is used to support. Name the acting person or agent accurately; an actor string is attribution, not independent verification.

Store work-specific knowledge in the child KB and project-wide knowledge in shared. Ignore material that has no bearing on the work. Keep open questions explicit where evidence is insufficient. Use explicit promotion only when the knowledge and its dependencies have appropriate project-wide scope; inspect any conflict review returned by the operation.

Record a claim's applicability and the rationale connecting its premises to the conclusion. Put jointly necessary premises in one justification group and genuinely alternative declared bases in separate groups. A provenance or contextual link alone does not assert sufficient support. The runtime tracks availability of the argument you supply; you remain responsible for whether that argument makes sense.

For a decision, record the options considered, selected option, constraints, rationale and explicit basis. For an artifact, record its file reference and basis. Retain the acceptance revision when citing why a historical choice was made. Later support is additional context, not the reason the original author necessarily used.

## Refresh and review

Refresh the relevant source or KB before rereading a whole corpus. Inspect the resulting ChangeSet and affected subgraph, then reassess only the implicated reasoning. A changed, missing or unavailable source means its support needs attention; it does not establish that a claim is false.

Preserve conflicting claims with an attributed contradiction and reason. Resolve only when the task supplies a defensible resolution and record the actor and rationale. Closing a review acknowledges the issue; it neither restores stale evidence nor resolves a separate contradiction. Record a new interpretation or explicit supersession when the conclusion changes.

After consequential updates, use `why`, `impact` and `audit` to check the intended evidence chain, affected artifacts and remaining uncertainty. Report unresolved reviews alongside the conclusion.

## Durable state

Mutate graph state through runtime operations. Generated OKF Markdown remains useful for reading, but edits to it do not update canonical history. Preserve native revision history for historical explanations; an OKF-only export is a current view. If the runtime reports corruption or projection drift, inspect the diagnostic and documented recovery operation before continuing writes.
