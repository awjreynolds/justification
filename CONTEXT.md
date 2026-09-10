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
