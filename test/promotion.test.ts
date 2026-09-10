import { strict as assert } from "node:assert";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { executeOperation, initializeProject } from "../src/index.ts";

test("promote preserves an attributed child explanation while exposing it to shared and siblings", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-promotion-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope",
      at: "2026-09-11T09:00:00Z"
    });
    await executeOperation(root, {
      op: "create_kb",
      id: "research",
      title: "Research",
      actor: "human:scope",
      at: "2026-09-11T09:00:01Z"
    });

    const sharedPremise = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "The cache must meet the latency constraint",
      body: "The shared benchmark requires the selected cache to stay below the latency limit.",
      actor: "human:researcher",
      at: "2026-09-11T09:01:00Z"
    });
    const sharedPremiseId = (sharedPremise.data as { node: { id: string } }).node.id;

    const childClaim = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "Redis satisfies the latency constraint",
      body: "Redis is the selected cache because the retained benchmark satisfies the shared latency constraint.",
      fields: { propositionKey: "cache.latency.redis" },
      actor: "human:author",
      at: "2026-09-11T09:02:00Z"
    });
    const childClaimNode = (childClaim.data as { node: { id: string; kb: string; kind: string; createdBy: string; createdAt: string; body: string; title: string; fields?: Record<string, unknown> } }).node;
    const childClaimId = childClaimNode.id;
    const originalCreated = {
      createdBy: childClaimNode.createdBy,
      createdAt: childClaimNode.createdAt,
      kind: childClaimNode.kind,
      title: childClaimNode.title,
      body: childClaimNode.body,
      fields: childClaimNode.fields
    };

    const justification = await executeOperation(root, {
      op: "justify",
      kb: "adr",
      conclusion: childClaimId,
      groups: [[sharedPremiseId]],
      rationale: "The shared latency constraint and benchmark support the Redis claim.",
      actor: "human:author",
      at: "2026-09-11T09:03:00Z"
    });
    const originalJustificationRecord = (justification.data as {
      justification: { id: string; kb: string; conclusion: string; groups: Array<{ id: string; premises: string[] }>; rationale: string; createdBy: string; createdAt: string }
    }).justification;
    const originalJustification = {
      id: originalJustificationRecord.id,
      kb: originalJustificationRecord.kb,
      conclusion: originalJustificationRecord.conclusion,
      groups: originalJustificationRecord.groups,
      rationale: originalJustificationRecord.rationale,
      createdBy: originalJustificationRecord.createdBy,
      createdAt: originalJustificationRecord.createdAt
    };

    const relationship = await executeOperation(root, {
      op: "relate",
      kb: "adr",
      from: childClaimId,
      to: sharedPremiseId,
      type: "depends_on",
      rationale: "The claim depends on the shared latency constraint.",
      actor: "human:author",
      at: "2026-09-11T09:04:00Z"
    });
    const originalRelationship = (relationship.data as {
      relationship: { id: string; kb: string; from: string; to: string; type: string; rationale?: string; createdBy: string; createdAt: string }
    }).relationship;

    const beforePromotion = await executeOperation(root, { op: "knowledge_bases" });
    const historicalRevision = beforePromotion.revision;
    const beforeWhy = await executeOperation(root, {
      op: "why",
      nodeId: childClaimId,
      kb: "adr",
      revision: historicalRevision,
      evaluationTime: "2026-09-11T12:00:00Z"
    });
    const beforeWhyData = beforeWhy.data as {
      node: { id: string; kb: string };
      originalBasis: unknown;
      currentSupport: Array<{ justification: { id: string; kb: string } }>;
    };
    assert.equal(beforeWhyData.node.kb, "adr");
    assert.equal(beforeWhyData.currentSupport[0]?.justification.id, originalJustification.id);

    await executeOperation(root, { op: "export", kb: "adr" });
    const oldGeneratedPath = join(root, "kb", "adr", `${childClaimId}.md`);
    const oldGeneratedBytes = await readFile(oldGeneratedPath, "utf8");
    assert.match(oldGeneratedBytes, new RegExp(childClaimId));
    const humanPath = join(root, "kb", "adr", "editor-notes.md");
    const humanBytes = "Keep this human-authored note beside the child projection.\n";
    await writeFile(humanPath, humanBytes, "utf8");
    await rm(join(root, ".justification"), { recursive: true, force: true });

    const reason = "The shared benchmark now makes this claim reusable by every knowledge base.";
    const promoted = await executeOperation(root, {
      op: "promote",
      nodeId: childClaimId,
      reason,
      actor: "human:promoter",
      at: "2026-09-11T09:05:00Z",
      expectedRevision: historicalRevision
    });
    const promotedData = promoted.data as {
      node: { id: string; kb: string; kind: string; createdBy: string; createdAt: string; title: string; body: string; fields?: Record<string, unknown> };
      scopeChange: { id: string; nodeId: string; from: string; to: string; reason?: string; createdBy: string; createdAt: string };
      justifications: Array<{ id: string; kb: string; conclusion: string; groups: Array<{ id: string; premises: string[] }>; rationale: string; createdBy: string; createdAt: string }>;
      relationships: Array<{ id: string; kb: string; from: string; to: string; type: string; rationale?: string; createdBy: string; createdAt: string }>;
      committed: boolean;
    };
    assert.equal(promoted.revision, historicalRevision + 1);
    assert.equal(promotedData.committed, true);
    assert.deepEqual(promotedData.scopeChange, {
      id: promotedData.scopeChange.id,
      nodeId: childClaimId,
      from: "adr",
      to: "shared",
      reason,
      createdBy: "human:promoter",
      createdAt: "2026-09-11T09:05:00.000Z"
    });
    assert.deepEqual(promotedData.node, {
      ...originalCreated,
      id: childClaimId,
      kb: "shared"
    });
    assert.deepEqual(promotedData.justifications, [{
      ...originalJustification,
      kb: "shared",
      conclusion: childClaimId
    }]);
    assert.deepEqual(promotedData.relationships, [{
      ...originalRelationship,
      kb: "shared",
      from: childClaimId,
      to: sharedPremiseId
    }]);

    const siblingWhy = await executeOperation(root, {
      op: "why",
      nodeId: childClaimId,
      kb: "research",
      evaluationTime: "2026-09-11T12:00:00Z"
    });
    const siblingWhyData = siblingWhy.data as {
      node: { id: string; kb: string };
      currentSupport: Array<{ justification: { id: string; kb: string }; groups: Array<{ premises: string[] }> }>;
      upstream: Array<{ id: string }>;
    };
    assert.equal(siblingWhyData.node.id, childClaimId);
    assert.equal(siblingWhyData.node.kb, "shared");
    assert.equal(siblingWhyData.currentSupport[0]?.justification.id, originalJustification.id);
    assert.equal(siblingWhyData.currentSupport[0]?.justification.kb, "shared");
    assert.deepEqual(siblingWhyData.currentSupport[0]?.groups[0]?.premises, [sharedPremiseId]);
    assert.equal(siblingWhyData.upstream.some((node) => node.id === sharedPremiseId), true);

    const historicalWhy = await executeOperation(root, {
      op: "why",
      nodeId: childClaimId,
      kb: "adr",
      revision: historicalRevision,
      evaluationTime: "2026-09-11T12:00:00Z"
    });
    const historicalWhyData = historicalWhy.data as {
      node: { id: string; kb: string; createdBy: string; createdAt: string };
      currentSupport: Array<{ justification: { id: string; kb: string } }>;
    };
    assert.equal(historicalWhyData.node.id, childClaimId);
    assert.equal(historicalWhyData.node.kb, "adr");
    assert.equal(historicalWhyData.node.createdBy, originalCreated.createdBy);
    assert.equal(historicalWhyData.node.createdAt, originalCreated.createdAt);
    assert.equal(historicalWhyData.currentSupport[0]?.justification.id, originalJustification.id);
    assert.equal(historicalWhyData.currentSupport[0]?.justification.kb, "adr");

    await assert.rejects(access(oldGeneratedPath), (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    });
    const sharedGeneratedPath = join(root, "kb", "shared", `${childClaimId}.md`);
    assert.match(await readFile(sharedGeneratedPath, "utf8"), new RegExp(childClaimId));
    assert.equal(await readFile(humanPath, "utf8"), humanBytes);

    await rm(join(root, ".justification"), { recursive: true, force: true });
    await executeOperation(root, { op: "rebuild", actor: "operator:recovery", at: "2026-09-11T12:00:00Z" });
    const afterRebuildWhy = await executeOperation(root, {
      op: "why",
      nodeId: childClaimId,
      kb: "research",
      evaluationTime: "2026-09-11T12:00:00Z"
    });
    const afterRebuildHistoricalWhy = await executeOperation(root, {
      op: "why",
      nodeId: childClaimId,
      kb: "adr",
      revision: historicalRevision,
      evaluationTime: "2026-09-11T12:00:00Z"
    });
    assert.deepEqual(afterRebuildWhy, siblingWhy);
    assert.deepEqual(afterRebuildHistoricalWhy, historicalWhy);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects promotion when a recorded decision basis remains child-scoped", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-promotion-recorded-basis-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope",
      at: "2026-09-11T13:00:00Z"
    });
    const premise = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "Child-only benchmark claim",
      body: "This benchmark was captured only for the ADR child.",
      actor: "human:author",
      at: "2026-09-11T13:00:01Z"
    });
    const premiseId = (premise.data as { node: { id: string } }).node.id;
    const decision = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "decision",
      title: "Choose the child-only benchmark",
      body: "The decision depends on a child-only benchmark.",
      basis: [premiseId],
      fields: { rationale: "The recorded basis is the child-only benchmark." },
      actor: "human:author",
      at: "2026-09-11T13:00:02Z"
    });
    const decisionId = (decision.data as { node: { id: string } }).node.id;
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "promote",
        nodeId: decisionId,
        actor: "human:promoter",
        at: "2026-09-11T13:00:03Z",
        expectedRevision: before.revision
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SCOPE_VIOLATION");
        const details = (error as { details?: { nodeId?: string; from?: string; to?: string; dependencyId?: string; dependencyKind?: string } }).details;
        assert.deepEqual(details, {
          nodeId: decisionId,
          from: "adr",
          to: "shared",
          dependencyId: premiseId,
          dependencyKind: "justification_premise"
        });
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    const historicalWhy = await executeOperation(root, { op: "why", nodeId: decisionId, kb: "adr" });
    const whyData = historicalWhy.data as {
      node: { id: string; kb: string };
      originalBasis: { justification: { kb: string; groups: Array<{ premises: string[] }> } };
    };
    assert.equal(whyData.node.kb, "adr");
    assert.equal(whyData.originalBasis.justification.kb, "adr");
    assert.deepEqual(whyData.originalBasis.justification.groups[0]?.premises, [premiseId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects promotion when a decision exposes a child-owned considered option", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-promotion-option-scope-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope",
      at: "2026-09-11T14:00:00Z"
    });
    const premise = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared constraint",
      body: "The shared constraint is satisfied.",
      actor: "human:author",
      at: "2026-09-11T14:00:01Z"
    });
    const premiseId = (premise.data as { node: { id: string } }).node.id;
    const option = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "option",
      title: "Child-only option",
      body: "This option is only relevant to the ADR child.",
      actor: "human:author",
      at: "2026-09-11T14:00:02Z"
    });
    const optionId = (option.data as { node: { id: string } }).node.id;
    const decision = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "decision",
      title: "Choose an option",
      body: "The decision is supported by the shared constraint.",
      basis: [premiseId],
      fields: { consideredOptions: [optionId], selectedOption: optionId },
      actor: "human:author",
      at: "2026-09-11T14:00:03Z"
    });
    const decisionId = (decision.data as { node: { id: string } }).node.id;
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "promote",
        nodeId: decisionId,
        actor: "human:promoter",
        at: "2026-09-11T14:00:04Z",
        expectedRevision: before.revision
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SCOPE_VIOLATION");
        const details = (error as { details?: { nodeId?: string; from?: string; to?: string; dependencyId?: string; dependencyKind?: string } }).details;
        assert.deepEqual(details, {
          nodeId: decisionId,
          from: "adr",
          to: "shared",
          dependencyId: optionId,
          dependencyKind: "considered_option"
        });
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    const explanation = await executeOperation(root, { op: "why", nodeId: decisionId, kb: "adr" });
    const explanationData = explanation.data as {
      node: { id: string; kb: string; fields?: { consideredOptions?: string[]; selectedOption?: string } };
    };
    assert.equal(explanationData.node.kb, "adr");
    assert.deepEqual(explanationData.node.fields?.consideredOptions, [optionId]);
    assert.equal(explanationData.node.fields?.selectedOption, optionId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires conflict resolution before promotion and retains the child conflict privately", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-promotion-conflict-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope",
      at: "2026-09-11T15:00:00Z"
    });
    await executeOperation(root, {
      op: "create_kb",
      id: "research",
      title: "Research",
      actor: "human:scope",
      at: "2026-09-11T15:00:01Z"
    });
    const shared = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared cache policy",
      body: "The shared policy selects a cache for the project.",
      actor: "human:shared",
      at: "2026-09-11T15:00:02Z"
    });
    const sharedId = (shared.data as { node: { id: string } }).node.id;
    const child = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "ADR cache policy",
      body: "The ADR selects a different cache for this decision.",
      actor: "human:author",
      at: "2026-09-11T15:00:03Z"
    });
    const childId = (child.data as { node: { id: string } }).node.id;
    const conflictRationale = "The ADR policy conflicts with the shared project policy.";
    const contradicted = await executeOperation(root, {
      op: "contradict",
      kb: "adr",
      left: childId,
      right: sharedId,
      rationale: conflictRationale,
      actor: "human:reviewer",
      at: "2026-09-11T15:00:04Z"
    });
    const contradiction = (contradicted.data as { contradiction: { id: string; status: string; kb: string } }).contradiction;
    const contradictionReview = (contradicted.data as { reviews: Array<{ id: string; nodeId: string; triggerId: string; status: string }> }).reviews[0];
    assert.equal(contradiction.kb, "adr");
    assert.equal(contradiction.status, "open");
    assert.equal(contradictionReview?.nodeId, childId);
    assert.equal(contradictionReview?.triggerId, contradiction.id);

    await executeOperation(root, { op: "export", kb: "adr" });
    const childNodePath = join(root, "kb", "adr", `${childId}.md`);
    const childIndexPath = join(root, "kb", "adr", "index.md");
    assert.match(await readFile(childNodePath, "utf8"), new RegExp(contradiction.id));
    const beforePromotion = await executeOperation(root, { op: "knowledge_bases" });
    await assert.rejects(
      executeOperation(root, {
        op: "promote",
        nodeId: childId,
        actor: "human:promoter",
        at: "2026-09-11T15:00:05Z",
        expectedRevision: beforePromotion.revision
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "REVIEW_REQUIRED");
        const details = (error as { details?: { nodeId?: string; conflictIds?: string[] } }).details;
        assert.deepEqual(details, { nodeId: childId, conflictIds: [contradiction.id] });
        return true;
      }
    );
    const afterRejectedPromotion = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(afterRejectedPromotion.revision, beforePromotion.revision);

    const resolved = await executeOperation(root, {
      op: "resolve_conflict",
      contradictionId: contradiction.id,
      resolution: "different_scope",
      kb: "adr",
      rationale: "The ADR policy is intentionally local to this decision.",
      actor: "human:resolver",
      at: "2026-09-11T15:00:06Z",
      expectedRevision: beforePromotion.revision
    });
    const resolvedContradiction = (resolved.data as { contradiction: { status: string; resolution: string } }).contradiction;
    assert.deepEqual(resolvedContradiction, {
      ...contradiction,
      status: "resolved",
      resolution: "different_scope",
      resolvedBy: "human:resolver",
      resolvedAt: "2026-09-11T15:00:06.000Z",
      resolutionRationale: "The ADR policy is intentionally local to this decision.",
      resolutionHistory: [{
        resolution: "different_scope",
        actor: "human:resolver",
        at: "2026-09-11T15:00:06.000Z",
        rationale: "The ADR policy is intentionally local to this decision."
      }]
    });
    await rm(join(root, ".justification"), { recursive: true, force: true });

    const promoted = await executeOperation(root, {
      op: "promote",
      nodeId: childId,
      actor: "human:promoter",
      at: "2026-09-11T15:00:07Z",
      expectedRevision: resolved.revision
    });
    const promotedData = promoted.data as {
      node: { id: string; kb: string };
      scopeChange: { id: string; nodeId: string; from: string; to: string; createdBy: string; createdAt: string };
      promoted: boolean;
      committed: boolean;
    };
    assert.equal(promotedData.promoted, true);
    assert.equal(promotedData.committed, true);
    assert.deepEqual(promotedData.scopeChange, {
      id: promotedData.scopeChange.id,
      nodeId: childId,
      from: "adr",
      to: "shared",
      createdBy: "human:promoter",
      createdAt: "2026-09-11T15:00:07.000Z"
    });
    assert.equal(promotedData.node.kb, "shared");
    await assert.rejects(readFile(childNodePath), (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    });
    assert.match(await readFile(join(root, "kb", "shared", `${childId}.md`), "utf8"), new RegExp(childId));
    const sharedNodeBytes = await readFile(join(root, "kb", "shared", `${childId}.md`), "utf8");
    assert.equal(sharedNodeBytes.includes(contradictionReview?.id ?? ""), false);
    assert.equal(sharedNodeBytes.includes("The ADR policy is intentionally local to this decision."), false);
    assert.match(await readFile(childIndexPath, "utf8"), new RegExp(contradiction.id));
    assert.match(await readFile(childIndexPath, "utf8"), new RegExp(conflictRationale));

    const childConflicts = await executeOperation(root, { op: "conflicts", kb: "adr" });
    assert.deepEqual((childConflicts.data as { conflicts: Array<{ id: string; status: string }> }).conflicts.map((item) => ({ id: item.id, status: item.status })), [{ id: contradiction.id, status: "resolved" }]);
    const sharedConflicts = await executeOperation(root, { op: "conflicts", kb: "shared" });
    assert.deepEqual((sharedConflicts.data as { conflicts: unknown[] }).conflicts, []);
    const siblingConflicts = await executeOperation(root, { op: "conflicts", kb: "research" });
    assert.deepEqual((siblingConflicts.data as { conflicts: unknown[] }).conflicts, []);

    const childReviews = await executeOperation(root, { op: "review", kb: "adr" });
    assert.equal((childReviews.data as { reviews: Array<{ id: string; nodeId: string; triggerId: string; status: string }> }).reviews.some((review) => review.id === contradictionReview?.id && review.nodeId === childId && review.triggerId === contradiction.id && review.status === "open"), true);
    const sharedReviews = await executeOperation(root, { op: "review", kb: "shared" });
    assert.equal((sharedReviews.data as { reviews: Array<{ triggerId: string }> }).reviews.some((review) => review.triggerId === contradiction.id), false);
    const siblingReviews = await executeOperation(root, { op: "review", kb: "research" });
    assert.equal((siblingReviews.data as { reviews: Array<{ triggerId: string }> }).reviews.some((review) => review.triggerId === contradiction.id), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creates a promotion review for a differing shared proposition and promotes after closure", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-promotion-proposition-conflict-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope",
      at: "2026-09-11T16:00:00Z"
    });
    const shared = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Cache policy",
      body: "The shared project uses the hosted cache.",
      fields: { propositionKey: "cache.selection" },
      actor: "human:shared",
      at: "2026-09-11T16:00:01Z"
    });
    const sharedId = (shared.data as { node: { id: string } }).node.id;
    const child = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "Cache policy",
      body: "The ADR uses the local cache.",
      fields: { propositionKey: "cache.selection" },
      actor: "human:author",
      at: "2026-09-11T16:00:02Z"
    });
    const childId = (child.data as { node: { id: string } }).node.id;
    const before = await executeOperation(root, { op: "knowledge_bases" });

    const pending = await executeOperation(root, {
      op: "promote",
      nodeId: childId,
      actor: "human:promoter",
      at: "2026-09-11T16:00:03Z",
      expectedRevision: before.revision
    });
    const pendingData = pending.data as {
      node: { id: string; kb: string };
      reviews: Array<{ id: string; kb?: string; nodeId: string; triggerType: string; triggerId: string; status: string; reason: string; createdBy: string; createdAt: string }>;
      conflicts: string[];
      committed: boolean;
      promoted: boolean;
    };
    assert.equal(pending.revision, before.revision + 1);
    assert.equal(pendingData.node.kb, "adr");
    assert.equal(pendingData.committed, true);
    assert.equal(pendingData.promoted, false);
    assert.deepEqual(pendingData.conflicts, [sharedId]);
    assert.equal(pendingData.reviews.length, 1);
    const promotionReview = pendingData.reviews[0];
    assert.deepEqual(promotionReview, {
      id: promotionReview.id,
      kb: "adr",
      nodeId: childId,
      triggerType: "promotion_conflict",
      triggerId: sharedId,
      status: "open",
      reason: `shared node ${sharedId} has the same proposition key with a different body`,
      createdBy: "human:promoter",
      createdAt: "2026-09-11T16:00:03.000Z"
    });

    const repeated = await executeOperation(root, {
      op: "promote",
      nodeId: childId,
      actor: "human:promoter",
      at: "2026-09-11T16:00:04Z",
      expectedRevision: pending.revision
    });
    const repeatedData = repeated.data as { committed: boolean; promoted: boolean; reviews: Array<{ id: string }> };
    assert.equal(repeated.revision, pending.revision);
    assert.equal(repeatedData.committed, false);
    assert.equal(repeatedData.promoted, false);
    assert.deepEqual(repeatedData.reviews.map((review) => review.id), [promotionReview.id]);

    const closed = await executeOperation(root, {
      op: "review",
      reviewId: promotionReview.id,
      status: "closed",
      kb: "adr",
      rationale: "The ADR choice is intentionally different from the shared policy.",
      actor: "human:resolver",
      at: "2026-09-11T16:00:05Z",
      expectedRevision: pending.revision
    });
    const closedReview = (closed.data as { review: { id: string; status: string; closureRationale: string } }).review;
    assert.equal(closedReview.id, promotionReview.id);
    assert.equal(closedReview.status, "closed");
    assert.equal(closedReview.closureRationale, "The ADR choice is intentionally different from the shared policy.");

    const promoted = await executeOperation(root, {
      op: "promote",
      nodeId: childId,
      actor: "human:promoter",
      at: "2026-09-11T16:00:06Z",
      expectedRevision: closed.revision
    });
    const promotedData = promoted.data as { node: { id: string; kb: string }; promoted: boolean; committed: boolean };
    assert.equal(promotedData.node.id, childId);
    assert.equal(promotedData.node.kb, "shared");
    assert.equal(promotedData.promoted, true);
    assert.equal(promotedData.committed, true);

    const promotedNodeBytes = await readFile(join(root, "kb", "shared", `${childId}.md`), "utf8");
    assert.equal(promotedNodeBytes.includes("The ADR choice is intentionally different from the shared policy."), false);

    const sharedReviews = await executeOperation(root, { op: "review", kb: "shared" });
    assert.equal((sharedReviews.data as { reviews: Array<{ id: string }> }).reviews.some((review) => review.id === promotionReview.id), false);
    const childReviews = await executeOperation(root, { op: "review", kb: "adr" });
    assert.equal((childReviews.data as { reviews: Array<{ id: string }> }).reviews.some((review) => review.id === promotionReview.id), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records caller-supplied promotion conflicts and requires their review closure", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-promotion-explicit-conflict-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope",
      at: "2026-09-11T17:00:00Z"
    });
    const shared = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared policy",
      body: "The shared policy is the project default.",
      actor: "human:shared",
      at: "2026-09-11T17:00:01Z"
    });
    const sharedId = (shared.data as { node: { id: string } }).node.id;
    const child = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "Local policy",
      body: "The ADR makes a local choice.",
      actor: "human:author",
      at: "2026-09-11T17:00:02Z"
    });
    const childId = (child.data as { node: { id: string } }).node.id;
    const before = await executeOperation(root, { op: "knowledge_bases" });

    const pending = await executeOperation(root, {
      op: "promote",
      nodeId: childId,
      conflicts: [sharedId],
      reason: "Make the local policy project-wide after review.",
      actor: "human:promoter",
      at: "2026-09-11T17:00:03Z",
      expectedRevision: before.revision
    });
    const pendingData = pending.data as {
      node: { id: string; kb: string };
      reviews: Array<{ id: string; kb?: string; nodeId: string; triggerType: string; triggerId: string; status: string; reason: string; createdBy: string; createdAt: string }>;
      conflicts: string[];
      promoted: boolean;
      committed: boolean;
    };
    assert.equal(pendingData.node.kb, "adr");
    assert.equal(pendingData.promoted, false);
    assert.equal(pendingData.committed, true);
    assert.deepEqual(pendingData.conflicts, [sharedId]);
    const review = pendingData.reviews[0];
    assert.deepEqual(review, {
      id: review.id,
      kb: "adr",
      nodeId: childId,
      triggerType: "promotion_conflict",
      triggerId: sharedId,
      status: "open",
      reason: `promotion conflict with shared node ${sharedId} was supplied explicitly`,
      createdBy: "human:promoter",
      createdAt: "2026-09-11T17:00:03.000Z"
    });

    const blockedRetry = await executeOperation(root, {
      op: "promote",
      nodeId: childId,
      actor: "human:promoter",
      at: "2026-09-11T17:00:04Z",
      expectedRevision: pending.revision
    });
    const blockedRetryData = blockedRetry.data as {
      node: { id: string; kb: string };
      reviews: Array<{ id: string; status: string }>;
      conflicts: string[];
      promoted: boolean;
      committed: boolean;
    };
    assert.equal(blockedRetry.revision, pending.revision);
    assert.equal(blockedRetryData.node.id, childId);
    assert.equal(blockedRetryData.node.kb, "adr");
    assert.deepEqual(blockedRetryData.conflicts, [sharedId]);
    assert.deepEqual(blockedRetryData.reviews.map(({ id, status }) => ({ id, status })), [{ id: review.id, status: "open" }]);
    assert.equal(blockedRetryData.promoted, false);
    assert.equal(blockedRetryData.committed, false);

    await executeOperation(root, {
      op: "review",
      reviewId: review.id,
      status: "closed",
      kb: "adr",
      rationale: "The caller-supplied conflict was explicitly reviewed.",
      actor: "human:resolver",
      at: "2026-09-11T17:00:05Z",
      expectedRevision: pending.revision
    });
    const promoted = await executeOperation(root, {
      op: "promote",
      nodeId: childId,
      reason: "Make the local policy project-wide after review.",
      actor: "human:promoter",
      at: "2026-09-11T17:00:06Z",
      expectedRevision: pending.revision + 1
    });
    const promotedData = promoted.data as { node: { id: string; kb: string }; promoted: boolean; committed: boolean };
    assert.equal(promotedData.node.id, childId);
    assert.equal(promotedData.node.kb, "shared");
    assert.equal(promotedData.promoted, true);
    assert.equal(promotedData.committed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires a source to be shared before promoting its captured evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-promotion-provenance-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope",
      at: "2026-09-11T18:00:00Z"
    });
    const sourcePath = join(root, "constraints.md");
    await writeFile(sourcePath, "The captured constraint.\n", "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      kb: "adr",
      locator: "constraints.md",
      actor: "human:researcher",
      at: "2026-09-11T18:00:01Z"
    });
    const capturedData = captured.data as {
      source: { id: string; nodeId: string; kb: string };
      evidence: { id: string; kb: string; sourceId: string };
    };
    assert.equal(capturedData.source.kb, "adr");
    assert.equal(capturedData.evidence.kb, "adr");
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "promote",
        nodeId: capturedData.evidence.id,
        actor: "human:promoter",
        at: "2026-09-11T18:00:02Z",
        expectedRevision: before.revision
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SCOPE_VIOLATION");
        assert.deepEqual((error as { details?: unknown }).details, {
          nodeId: capturedData.evidence.id,
          from: "adr",
          to: "shared",
          dependencyId: capturedData.source.nodeId,
          dependencyKind: "source_provenance"
        });
        return true;
      }
    );
    assert.equal((await executeOperation(root, { op: "knowledge_bases" })).revision, before.revision);

    const promotedSource = await executeOperation(root, {
      op: "promote",
      nodeId: capturedData.source.nodeId,
      actor: "human:promoter",
      at: "2026-09-11T18:00:03Z",
      expectedRevision: before.revision
    });
    assert.equal((promotedSource.data as { node: { kb: string } }).node.kb, "shared");
    const promotedEvidence = await executeOperation(root, {
      op: "promote",
      nodeId: capturedData.evidence.id,
      actor: "human:promoter",
      at: "2026-09-11T18:00:04Z",
      expectedRevision: promotedSource.revision
    });
    const promotedEvidenceData = promotedEvidence.data as { node: { id: string; kb: string } };
    assert.equal(promotedEvidenceData.node.id, capturedData.evidence.id);
    assert.equal(promotedEvidenceData.node.kb, "shared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
