# Choose artifact assertion anchors and acceptable drift behavior

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: open
Assignee:
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 05, 07

Prerequisites: [Define the minimum evidence and justification model](05-minimum-domain.md); [Choose durable authority and an honest OKF compatibility boundary](07-persistence-authority.md)

## Question

How does an ADR assertion refer to its supporting decision/claim and the exact artifact version? Compare a whole-artifact link, explicit stable Markdown assertion IDs, and richer sentence anchoring. Define the minimum needed to demonstrate traceability and flag an edited/moved/deleted assertion as drift instead of silently attaching its justification to new text. Decide whether generation is needed or referencing a fixture ADR suffices, and clearly bound the later “why this sentence?” feature.
