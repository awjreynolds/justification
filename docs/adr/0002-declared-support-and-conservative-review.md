# ADR 0002: Declared support and conservative review

Status: accepted for MVP under the user's completion instruction, 2026-09-10.

A citation establishes provenance but does not establish evidential sufficiency. Changed evidence may warrant reviewing a decision even when another declared argument still supports it. Treating all these states as one confidence or truth score would make explanations misleading.

Separate source identity, immutable evidence observations, attributed propositions, support groups, contradictions and review issues. A support group declares that all its premises together support one conclusion; alternative groups preserve alternative bases. Refuse cycles in support. Record ordinary provenance/context links separately from sufficient support. The runtime evaluates availability and declared applicability deterministically, without claiming to prove an inference.

Keep freshness, support availability and open review independent. A changed or missing source can make old evidence historical and a downstream basis pending. It does not make the claim false. An intact alternative may remain usable while review flags the historically relied-on basis. Historical revision queries retain exactly what was recorded then.

Contradictions are explicit attributed allegations; resolving them requires an actor, a resolution kind and reasons. Closing a review is an acknowledgment, not a new verification or an automatic rewrite of old evidence. New interpretations and superseding knowledge are explicit mutations supplied by a person or agent.

The first runtime therefore supplies deterministic dependency maintenance, not theorem proving, autonomous contradiction detection or semantic reassessment. [Primary-source research](../research/justification-semantics.md) explains the concepts borrowed from PROV, ATMS, SACM, IBIS/QOC and OSLC without promising implementation of those standards.
