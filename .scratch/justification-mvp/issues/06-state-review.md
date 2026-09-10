# Separate freshness, belief and review state without rewriting history

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: open
Assignee:
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 05

Prerequisites: [Define the minimum evidence and justification model](05-minimum-domain.md)

## Question

Which states and transitions can the runtime compute deterministically, and which require an attributed human/agent assessment? Separate source availability, evidence revision/freshness, claim epistemic status, decision review status and supersession. Define who may mark a claim verified, what verification means, how multiple independent supports affect impact, and whether “invalid” describes a source reference or a false claim. Define contradiction identity and resolution records, idempotent ReviewIssue creation, review closure and reopening after later changes. Preserve historical decisions and unresolved contradictions; freshness never proves or disproves a claim.
