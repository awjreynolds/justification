# Justification

Justification owns the reasoning, provenance and relationships between knowledge derived from authoritative source systems. Its language distinguishes project knowledge from the systems that provide it.

## Language

**Project**:
A bounded body of work whose knowledge bases share a project-wide context.

**Knowledge base (KB)**:
A collection of knowledge scoped to a project or a particular piece of work or output.

**Shared knowledge**:
Project-wide knowledge available to child knowledge bases through inheritance, without duplicating it into each child.

**Knowledge provider**:
A source system that remains authoritative for observations in its own domain, such as a repository service, file collection or issue tracker.
_Avoid_: Treating Justification as the authority for the provider's underlying observations.

**Artifact**:
An output whose consequential assertions should have traceable justification, such as an ADR, report, plan or proposal.

**Contradiction**:
A recorded conflict between pieces of knowledge that remains visible until an explicit resolution accounts for it.

**Promotion**:
The explicit movement of knowledge from a narrower scope into shared knowledge, preserving provenance and exposing conflicts for review.

**Justification impact**:
The potential effect of changed support on dependent knowledge and artifacts.
_Avoid_: Equating a dependency being affected with its conclusion being false.

**Source**:
A continuing identity and locator in an authoritative knowledge provider, distinct from a captured version of its content.

**Evidence observation**:
An immutable retained source observation, including its content, provider revision, observation time and attribution. Capturing it does not establish that it is correct or sufficient for a claim.

**Claim**:
An attributed proposition whose applicability is independent of its storage scope. An assumption or requirement is an explicit kind of proposition, not inferred from wording.

**Justification group**:
An attributed declaration that a nonempty set of premises jointly supports a conclusion. All premises are required within a group; separate groups are alternative declared bases.

**Usable support**:
A declared basis whose premises are currently available and applicable according to the runtime's checks. This describes a supplied argument's status, not machine-certified truth or entailment.

**Review issue**:
An attributed, durable item identifying knowledge that needs reassessment after a change or challenge. Closing it records an acknowledgment and rationale; it does not rewrite evidence or resolve a separate contradiction.

**Revision**:
A committed snapshot of project semantic state. Historical explanations name a revision so later observations cannot silently alter what was recorded.

**Compiled knowledge**:
The current readable OKF projection of project history. It remains useful without the runtime, while complete historical reconstruction also requires durable revision files.
