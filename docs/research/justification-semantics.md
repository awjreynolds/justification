# Minimum justification semantics: research findings

Research date: 2026-09-10. Planning input for **Identify the minimum rigorous semantics for provenance and weakened support**. These recommendations do not settle the ontology or authorize a reasoner implementation.

## Findings from primary sources

**PROV supplies provenance, not evidential sufficiency.** PROV-DM distinguishes entities with fixed aspects, activities acting on entities, and responsible agents. Derivation records transformation or construction from prior entities; it does not say that a resulting proposition follows logically. Generation and invalidation describe an entity's lifetime; invalidation is cessation, destruction or expiry, not a declaration that a proposition is false. Versioned observations should therefore remain distinguishable from the continuing source identity. [W3C PROV-DM, §§5.1–5.2](https://www.w3.org/TR/prov-dm/)

**TMS/ATMS tracks supplied dependencies.** De Kleer's original paper distinguishes the problem solver, which supplies meanings and justifications, from dependency maintenance. An ATMS justification has conjunctive antecedents and one consequent. A node can have multiple justifications; its label summarizes alternative sufficient assumption environments. Inconsistent environments are recorded as nogoods. Well-founded support matters: circular support alone is insufficient. Retraction requires downstream recomputation and can be expensive; the paper explicitly describes potentially exponential environment sets. These are useful concepts, not a requirement to implement ATMS labels or backtracking. [De Kleer, *An assumption-based TMS* (1986), §§3–4](https://www.dekleer.org/Publications/An%20Assumption-Based%20TMS.pdf)

**SACM makes the reasoning relationship itself assertable.** Claims record propositions; artifact references cite evidence or context; ArgumentReasoning explains asserted relationships. AssertedInference represents a user's declaration that premises support a conclusion, and is itself an assertion. SACM distinguishes assumed claims, claims needing support, and defeated claims; it also represents counter-evidence. A citation and an argument for its relevance are different things. [OMG SACM 2.3, §§11.9–11.15](https://www.omg.org/spec/SACM/2.3/PDF)

**IBIS and QOC preserve the choice being justified.** IBIS distinguishes issues, positions, arguments, and factual questions; arguments can defend or oppose positions. Challenging an answer can open another issue. QOC distinguishes design questions, possible options, and assessment criteria; its authors describe design-space analysis as a constructed rationale alongside the artifact, rather than a transcript of the design process. [Kunz and Rittel (1970), §§2,5–8, institutional record](https://escholarship.org/uc/item/5cj786v8), [paper text consulted](https://studylib.net/doc/14317137/issues-as-elements-of-information-systems-working-paper-n...), [MacLean et al. (1991), author-deposited abstract](https://www.researchgate.net/publication/233367028_Questions_Options_and_Criteria_Elements_of_Design_Space_Analysis)

**OSLC contributes identity and federation discipline.** Its link guidance recommends URI references, keeping a link assertion in one authoritative place, and deriving reverse navigation instead of maintaining redundant inverse assertions. Its configuration model distinguishes a continuing concept resource from specific versions: the same concept URI can resolve differently in different configurations. [OSLC Link Guidance, §§1–2](https://docs.oasis-open-projects.org/oslc-op/link-guidance/v1.0/link-guidance.html), [OSLC Configuration Management, §1.3](https://docs.oasis-open-projects.org/oslc-op/config/v1.0/oslc-config-mgt.html)

## Proposed MVP vocabulary and boundaries

The following are project proposals, not definitions mandated by those sources. They can be records or embedded structures; they need not all become top-level node types.

| Concept | Minimum meaning |
| --- | --- |
| Source | Provider-owned resource identity and locator; distinct from any captured revision. |
| Observation | A retrieval or measurement occurrence: actor/tool, query or selector, source revision, observation time and returned data. It may be mistaken. |
| Evidence | An identifiable, retained observation/excerpt used in reasoning; preserves provenance and content or an immutable retrievable reference. It does not automatically prove a claim. |
| Claim | An attributed proposition with explicit applicability, including subject, version/time where relevant, and assumptions. |
| Justification/inference | A named support group: premise references, conclusion reference, rationale, author, applicability and assessment. |
| Argument | The connected justification structure explaining a claim or choice; no additional heavyweight container required initially. |
| Contradiction | A reviewable allegation of incompatible propositions or requirements under overlapping applicability, with rationale, provenance and resolution history. |

An assumption can initially be a claim explicitly accepted without supporting evidence. Requirements and criteria can be typed claims or decision fields. A decision records an actor's selection, options considered, criteria and the rationale used; rejecting an option does not assert that all claims about it are false.

Keep `derived_from` separate from `supports`: the former answers origin, the latter asserts relevance or sufficiency. Keep contextual links such as `relevant_to` outside support calculations.

## Proposed support and change rules

1. **AND within a group; alternatives across groups.** For claim C, J1=[A,B] and J2=[D] mean `(A AND B) OR D`. Neither A nor B alone suffices through J1. D is an alternative declared sufficient basis, not automatically an independent source. Store the grouping; flat `supports` edges cannot express this distinction. Require nonempty premise groups; record assumptions explicitly instead of making empty groups vacuously sufficient.
2. **Track availability of a declared basis, not machine-certified truth.** A group is currently usable only when its declared prerequisites and applicability checks pass. Unknown checks produce a pending assessment. A claim can retain one usable basis while another needs review. Fewer usable groups means lost alternatives, not a numerical confidence reduction.
3. **Separate freshness, support and review.** Freshness concerns whether evidence has been checked against the relevant source state. Support records which groups are usable, pending or withdrawn. Review records unresolved challenges. Avoid one ordered status ladder: supported and disputed can coexist. Never infer falsehood from missing evidence, expiry, fetch failure, withdrawn support or a changed hash.
4. **Compute impact conservatively.** A detected source change identifies affected evidence and traverses declared justification/artifact dependencies. Return paths and reasons. Reachability means potentially affected, not necessarily unsupported. Reassess group availability before reporting support loss; an intact alternative can preserve support while the original decision basis still requires review.
5. **Preserve history.** Capture a new observation for a new source state. Pin recorded decisions and artifact assertions to the evidence, claims and justifications actually used. Keep withdrawal/supersession records rather than redirecting old references silently. Distinguish “why accepted then?” from “is its basis usable now?” Observation time, provider revision and proposition applicability time are separate fields.
6. **Do not substitute freshness for correctness.** A refreshed source may repeat an error. Validation of retrieval/integrity and human or semantic assessment of a claim need distinct records, including actor, time, method and target revision. A later correction can challenge an old decision's basis without erasing what the decision-maker knew then.

For the ADR fixture, change A while B and D remain usable. J1 becomes pending; J2 survives. The answer must show both facts, flag the decision if it relied on J1, and retain the original ADR explanation. Removing D as well leaves no currently usable declared basis, still without establishing that C is false.

## Proposed scope and contradiction handling

KB inheritance supplies visibility through references; it does not broaden a proposition's applicability. Shared knowledge about production version 1 is not automatically applicable to a child's version 2 experiment. Avoid local shadowing by label: preserve stable IDs and explicit disagreements. Promotion changes storage/visibility through an attributed operation, with conflict review where needed.

A contradiction record should name both sides, the alleged overlapping scope/time, reporter, rationale, evidence, and status. Allowed resolutions include supersession, different scopes, different times, source error and unresolved. Record the resolving actor and reasons. Plain-text claims cannot reliably yield deterministic semantic contradictions; automatic detection should produce candidates unless a narrowly specified structured constraint is violated. No winner selection, automatic retraction, or logical explosion follows from an unresolved conflict.

## Limits and decisions still needed

This review verifies selected primary sections, not standards conformance. QOC coverage uses its author-deposited abstract; IBIS uses the original paper's text transcription alongside its institutional record. No implementation or performance experiment was conducted.

Exclude full PROV/SACM/OSLC serialization, ATMS environment enumeration, default negation, theorem proving, probabilistic confidence arithmetic, automatic contradiction resolution, and automatic source-truth adjudication. For the first slice, require acyclic justification dependencies; ordinary reference links may cycle and traversals need visited-node handling.

Decide next: whether evidence is embedded or addressable; who can approve a sufficient support group; exact freshness and pending-state policies; whether every changed relied-on basis creates review despite surviving alternatives; the minimum structured applicability fields; and how much immutable source content can be retained. Those choices need the domain decision ticket, not further wholesale ontology adoption.
