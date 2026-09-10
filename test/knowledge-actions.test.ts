import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseDocument } from "yaml";

import { executeOperation, initializeProject } from "../src/index.ts";

test("closes a source-change review without refreshing stale support and preserves later review work", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-knowledge-actions-review-"));
  try {
    await initializeProject(root);
    const sourceLocator = "research/source.txt";
    await mkdir(join(root, "research"), { recursive: true });
    await writeFile(join(root, sourceLocator), "research result: initial\n", "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      kb: "shared",
      locator: sourceLocator,
      actor: "human:source"
    });
    const capturedData = captured.data as {
      source: { id: string };
      evidence: { id: string };
    };
    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "The initial result remains supported",
      body: "The retained initial observation supports this claim.",
      actor: "human:researcher"
    });
    const claimId = (claim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: claimId,
      groups: [[capturedData.evidence.id]],
      rationale: "The retained initial observation supports the claim.",
      actor: "human:researcher"
    });

    await writeFile(join(root, sourceLocator), "research result: changed\n", "utf8");
    const firstRefresh = await executeOperation(root, {
      op: "refresh",
      sourceIds: [capturedData.source.id],
      actor: "human:refresh"
    });
    const firstRefreshData = firstRefresh.data as { changes: Array<{ id: string }> };
    const firstChange = firstRefreshData.changes[0];
    assert.ok(firstChange);
    const firstReviews = await executeOperation(root, { op: "review", kb: "shared" });
    const firstReviewsData = firstReviews.data as {
      reviews: Array<{ id: string; nodeId: string; triggerId: string; status: string }>;
    };
    const claimReview = firstReviewsData.reviews.find((review) => review.nodeId === claimId && review.triggerId === firstChange.id);
    assert.ok(claimReview);
    assert.equal(claimReview.status, "open");

    const closedAt = "2026-09-10T15:00:00Z";
    const closureRationale = "Rechecked the retained observation and accepted the remaining review work.";
    const closed = await executeOperation(root, {
      op: "review",
      reviewId: claimReview.id,
      status: "closed",
      rationale: closureRationale,
      actor: "human:reviewer",
      at: closedAt,
      expectedRevision: firstReviews.revision
    });
    const closedData = closed.data as {
      review: {
        id: string;
        nodeId: string;
        triggerId: string;
        status: string;
        closedBy?: string;
        closedAt?: string;
        closureRationale?: string;
        closureHistory?: Array<{ status: string; actor: string; at: string; rationale: string }>;
      };
      committed: boolean;
      idempotent: boolean;
    };
    assert.equal(closed.revision, firstReviews.revision + 1);
    assert.equal(closedData.committed, true);
    assert.equal(closedData.idempotent, false);
    assert.equal(closedData.review.id, claimReview.id);
    assert.equal(closedData.review.nodeId, claimId);
    assert.equal(closedData.review.triggerId, firstChange.id);
    assert.equal(closedData.review.status, "closed");
    assert.equal(closedData.review.closedBy, "human:reviewer");
    assert.equal(closedData.review.closedAt, "2026-09-10T15:00:00.000Z");
    assert.equal(closedData.review.closureRationale, closureRationale);
    assert.deepEqual(closedData.review.closureHistory, [{
      status: "closed",
      actor: "human:reviewer",
      at: "2026-09-10T15:00:00.000Z",
      rationale: closureRationale
    }]);

    const whyAfterClosure = await executeOperation(root, { op: "why", nodeId: claimId, kb: "shared" });
    assert.equal((whyAfterClosure.data as { support: { status: string } }).support.status, "pending");

    await executeOperation(root, { op: "export", kb: "shared" });
    const markdownBeforeIdempotentRetry = await readFile(join(root, "kb", "shared", `${claimId}.md`), "utf8");

    const repeated = await executeOperation(root, {
      op: "review",
      reviewId: claimReview.id,
      status: "closed",
      rationale: closureRationale,
      actor: "human:reviewer",
      expectedRevision: closed.revision
    });
    const repeatedData = repeated.data as {
      review: { closureHistory?: Array<unknown> };
      committed: boolean;
      idempotent: boolean;
    };
    assert.equal(repeated.revision, closed.revision);
    assert.equal(repeatedData.committed, false);
    assert.equal(repeatedData.idempotent, true);
    assert.equal((repeatedData.review as { closedAt?: string }).closedAt, closedData.review.closedAt);
    assert.deepEqual(repeatedData.review.closureHistory, closedData.review.closureHistory);
    assert.equal(await readFile(join(root, "kb", "shared", `${claimId}.md`), "utf8"), markdownBeforeIdempotentRetry);

    await writeFile(join(root, sourceLocator), "research result: changed again\n", "utf8");
    const secondRefresh = await executeOperation(root, {
      op: "refresh",
      sourceIds: [capturedData.source.id],
      actor: "human:refresh"
    });
    const secondRefreshData = secondRefresh.data as { changes: Array<{ id: string }> };
    const secondChange = secondRefreshData.changes[0];
    assert.ok(secondChange);
    assert.notEqual(secondChange.id, firstChange.id);

    const allReviews = await executeOperation(root, { op: "review", kb: "shared" });
    const claimReviews = (allReviews.data as {
      reviews: Array<{ id: string; nodeId: string; triggerId: string; status: string; closedBy?: string; closureRationale?: string }>;
    }).reviews.filter((review) => review.nodeId === claimId);
    assert.equal(claimReviews.length, 2);
    assert.deepEqual(claimReviews.map((review) => ({ triggerId: review.triggerId, status: review.status })), [
      { triggerId: firstChange.id, status: "closed" },
      { triggerId: secondChange.id, status: "open" }
    ]);
    assert.equal(claimReviews[0]?.closedBy, "human:reviewer");
    assert.equal(claimReviews[0]?.closureRationale, closureRationale);

    await executeOperation(root, { op: "export", kb: "shared" });
    const claimDocument = await readFile(join(root, "kb", "shared", `${claimId}.md`), "utf8");
    const claimClosing = claimDocument.indexOf("\n---\n", 4);
    const claimFrontmatter = parseDocument(claimDocument.slice(4, claimClosing)).toJSON() as {
      justification?: {
        reviews?: Array<{ id: string; status: string; closureHistory?: Array<{ rationale: string }> }>;
      };
    };
    const projectedClosure = claimFrontmatter.justification?.reviews?.find((review) => review.id === claimReview.id);
    assert.equal(projectedClosure?.status, "closed");
    assert.equal(projectedClosure?.closureHistory?.[0]?.rationale, closureRationale);
    assert.equal(claimDocument.includes("## Review status"), true);
    assert.equal(claimDocument.includes("support depends on changed evidence"), true);
    assert.equal(claimDocument.includes(closureRationale), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a child-scoped contradiction whose endpoints are both shared", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-knowledge-actions-ownerless-conflict-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope",
      at: "2026-09-11T10:00:00Z"
    });
    const left = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared claim A",
      body: "The shared evidence supports claim A.",
      actor: "human:shared",
      at: "2026-09-11T10:00:01Z"
    });
    const right = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared claim B",
      body: "The shared evidence supports claim B.",
      actor: "human:shared",
      at: "2026-09-11T10:00:02Z"
    });
    const leftId = (left.data as { node: { id: string } }).node.id;
    const rightId = (right.data as { node: { id: string } }).node.id;

    await executeOperation(root, { op: "export", kb: "adr" });
    const childIndexPath = join(root, "kb", "adr", "index.md");
    const childIndexBefore = await readFile(childIndexPath, "utf8");
    const humanPath = join(root, "kb", "adr", "editor-notes.md");
    const humanBytes = "Keep this child-owned note unchanged.\n";
    await writeFile(humanPath, humanBytes, "utf8");
    const before = await executeOperation(root, { op: "knowledge_bases" });

    const conflictRationale = "These shared claims cannot be owned by an ADR child without a local endpoint.";
    await assert.rejects(
      executeOperation(root, {
        op: "contradict",
        kb: "adr",
        left: leftId,
        right: rightId,
        rationale: conflictRationale,
        actor: "human:reviewer",
        at: "2026-09-11T10:00:03Z",
        expectedRevision: before.revision
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SCOPE_VIOLATION");
        const details = (error as { details?: { kb?: string; left?: string; right?: string } }).details;
        assert.deepEqual(details, { kb: "adr", left: leftId, right: rightId });
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    const conflicts = await executeOperation(root, { op: "conflicts", kb: "adr" });
    assert.deepEqual((conflicts.data as { conflicts: unknown[] }).conflicts, []);
    assert.equal(await readFile(childIndexPath, "utf8"), childIndexBefore);
    assert.equal(await readFile(humanPath, "utf8"), humanBytes);
    await executeOperation(root, { op: "export", kb: "adr" });
    assert.equal((await readFile(childIndexPath, "utf8")).includes(conflictRationale), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records scoped contradictions, preserves resolution history, and keeps unresolved conflicts open", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-knowledge-actions-conflict-"));
  try {
    await initializeProject(root);
    const child = await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope"
    });
    await executeOperation(root, {
      op: "create_kb",
      id: "research",
      title: "Research",
      actor: "human:scope"
    });
    const shared = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared retention policy",
      body: "The shared policy retains logs for 30 days.",
      actor: "human:shared"
    });
    const sharedId = (shared.data as { node: { id: string } }).node.id;
    const local = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "ADR retention policy",
      body: "The ADR proposes retaining logs for 90 days.",
      actor: "human:local"
    });
    const localId = (local.data as { node: { id: string } }).node.id;
    assert.equal(child.revision, 1);

    const contradictionRationale = "The shared policy and ADR proposal claim different retention periods.";
    const contradicted = await executeOperation(root, {
      op: "contradict",
      kb: "adr",
      left: sharedId,
      right: localId,
      rationale: contradictionRationale,
      actor: "human:reviewer",
      at: "2026-09-10T16:00:00Z"
    });
    const contradictedData = contradicted.data as {
      contradiction: {
        id: string;
        kb: string;
        left: string;
        right: string;
        rationale: string;
        status: string;
      };
      reviews: Array<{ nodeId: string; triggerId: string; triggerType: string; status: string }>;
      committed: boolean;
    };
    assert.equal(contradicted.revision, 5);
    assert.equal(contradictedData.committed, true);
    assert.equal(contradictedData.contradiction.kb, "adr");
    assert.deepEqual(
      {
        left: contradictedData.contradiction.left,
        right: contradictedData.contradiction.right,
        rationale: contradictedData.contradiction.rationale,
        status: contradictedData.contradiction.status
      },
      { left: sharedId, right: localId, rationale: contradictionRationale, status: "open" }
    );
    assert.deepEqual(contradictedData.reviews.map((review) => ({
      nodeId: review.nodeId,
      triggerId: review.triggerId,
      triggerType: review.triggerType,
      status: review.status
    })), [{ nodeId: localId, triggerId: contradictedData.contradiction.id, triggerType: "contradiction", status: "open" }]);

    const sharedConflicts = await executeOperation(root, { op: "conflicts", kb: "shared" });
    const sharedConflictData = sharedConflicts.data as {
      conflicts: Array<{ id: string }>;
      contradictions: Array<{ id: string }>;
    };
    assert.deepEqual(sharedConflictData.conflicts, []);
    assert.deepEqual(sharedConflictData.contradictions, []);

    const localConflicts = await executeOperation(root, { op: "conflicts", kb: "adr" });
    const localConflictData = localConflicts.data as {
      conflicts: Array<{ id: string; kb: string; rationale: string; status: string }>;
      contradictions: Array<{ id: string }>;
    };
    assert.deepEqual(localConflictData.conflicts.map((conflict) => ({
      id: conflict.id,
      kb: conflict.kb,
      rationale: conflict.rationale,
      status: conflict.status
    })), [{ id: contradictedData.contradiction.id, kb: "adr", rationale: contradictionRationale, status: "open" }]);
    assert.deepEqual(localConflictData.contradictions.map((conflict) => conflict.id), [contradictedData.contradiction.id]);

    await assert.rejects(
      executeOperation(root, {
        op: "resolve_conflict",
        kb: "adr",
        contradictionId: contradictedData.contradiction.id,
        resolution: "supersession",
        rationale: "A winner is required for supersession.",
        actor: "human:reviewer",
        at: "2026-09-10T16:05:00Z",
        expectedRevision: localConflicts.revision
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "INVALID_REQUEST");
        return true;
      }
    );
    assert.equal((await executeOperation(root, { op: "conflicts", kb: "adr" })).revision, localConflicts.revision);

    const differentScope = await executeOperation(root, {
      op: "resolve_conflict",
      kb: "adr",
      contradictionId: contradictedData.contradiction.id,
      resolution: "different_scope",
      rationale: "The shared policy and local ADR apply to different scopes.",
      actor: "human:resolver-one",
      at: "2026-09-10T16:10:00Z",
      expectedRevision: localConflicts.revision
    });
    const differentScopeData = differentScope.data as {
      contradiction: {
        status: string;
        resolution?: string;
        resolvedBy?: string;
        resolvedAt?: string;
        resolutionRationale?: string;
        resolutionHistory?: Array<{ resolution: string; actor: string; at: string; rationale: string }>;
      };
    };
    assert.equal(differentScopeData.contradiction.status, "resolved");
    assert.equal(differentScopeData.contradiction.resolution, "different_scope");
    assert.equal(differentScopeData.contradiction.resolvedBy, "human:resolver-one");
    assert.equal(differentScopeData.contradiction.resolvedAt, "2026-09-10T16:10:00.000Z");
    assert.equal(differentScopeData.contradiction.resolutionRationale, "The shared policy and local ADR apply to different scopes.");
    assert.deepEqual(differentScopeData.contradiction.resolutionHistory, [{
      resolution: "different_scope",
      actor: "human:resolver-one",
      at: "2026-09-10T16:10:00.000Z",
      rationale: "The shared policy and local ADR apply to different scopes."
    }]);

    const superseded = await executeOperation(root, {
      op: "resolve_conflict",
      kb: "adr",
      contradictionId: contradictedData.contradiction.id,
      resolution: "supersession",
      winnerId: localId,
      rationale: "The ADR proposal supersedes the shared policy for this decision.",
      actor: "human:resolver-two",
      at: "2026-09-10T16:20:00Z",
      expectedRevision: differentScope.revision
    });
    const supersededData = superseded.data as {
      contradiction: {
        status: string;
        resolution?: string;
        winnerId?: string;
        resolutionHistory?: Array<{ resolution: string; winnerId?: string; actor: string; at: string; rationale: string }>;
      };
    };
    assert.equal(supersededData.contradiction.status, "resolved");
    assert.equal(supersededData.contradiction.resolution, "supersession");
    assert.equal(supersededData.contradiction.winnerId, localId);
    assert.deepEqual(supersededData.contradiction.resolutionHistory, [
      {
        resolution: "different_scope",
        actor: "human:resolver-one",
        at: "2026-09-10T16:10:00.000Z",
        rationale: "The shared policy and local ADR apply to different scopes."
      },
      {
        resolution: "supersession",
        winnerId: localId,
        actor: "human:resolver-two",
        at: "2026-09-10T16:20:00.000Z",
        rationale: "The ADR proposal supersedes the shared policy for this decision."
      }
    ]);

    await executeOperation(root, { op: "export", kb: "adr" });
    const resolvedLocalDocument = await readFile(join(root, "kb", "adr", `${localId}.md`), "utf8");
    const resolvedLocalClosing = resolvedLocalDocument.indexOf("\n---\n", 4);
    const resolvedLocalFrontmatter = parseDocument(resolvedLocalDocument.slice(4, resolvedLocalClosing)).toJSON() as {
      justification?: { contradictions?: Array<{ id: string; status: string; winnerId?: string; resolutionHistory?: Array<{ resolution: string }> }> };
    };
    const projectedResolvedConflict = resolvedLocalFrontmatter.justification?.contradictions?.find((conflict) => conflict.id === contradictedData.contradiction.id);
    assert.equal(projectedResolvedConflict?.status, "resolved");
    assert.equal(projectedResolvedConflict?.winnerId, localId);
    assert.equal(projectedResolvedConflict?.resolutionHistory?.length, 2);
    assert.equal(resolvedLocalDocument.includes("## Conflicts"), true);
    assert.equal(resolvedLocalDocument.includes(contradictionRationale), true);
    assert.equal(resolvedLocalDocument.includes("The ADR proposal supersedes the shared policy for this decision."), true);

    const unresolved = await executeOperation(root, {
      op: "resolve_conflict",
      kb: "adr",
      contradictionId: contradictedData.contradiction.id,
      resolution: "unresolved",
      rationale: "The available records do not establish which statement should win.",
      actor: "human:resolver-three",
      at: "2026-09-10T16:30:00Z",
      expectedRevision: superseded.revision
    });
    const unresolvedData = unresolved.data as {
      contradiction: {
        status: string;
        resolution?: string;
        winnerId?: string;
        resolvedBy?: string;
        resolutionHistory?: Array<{ resolution: string; actor: string; at: string; rationale: string }>;
      };
    };
    assert.equal(unresolvedData.contradiction.status, "open");
    assert.equal(unresolvedData.contradiction.resolution, "unresolved");
    assert.equal(unresolvedData.contradiction.winnerId, undefined);
    assert.equal(unresolvedData.contradiction.resolvedBy, undefined);
    assert.equal(unresolvedData.contradiction.resolutionHistory?.length, 3);
    assert.deepEqual(unresolvedData.contradiction.resolutionHistory?.[2], {
      resolution: "unresolved",
      actor: "human:resolver-three",
      at: "2026-09-10T16:30:00.000Z",
      rationale: "The available records do not establish which statement should win."
    });

    const sharedWhy = await executeOperation(root, { op: "why", nodeId: sharedId, kb: "shared" });
    const sharedWhyText = JSON.stringify(sharedWhy.data);
    assert.equal(sharedWhyText.includes(localId), false);
    assert.equal(sharedWhyText.includes(contradictionRationale), false);
    assert.equal((sharedWhy.data as { support: { status: string } }).support.status, "pending");
    const sharedSearch = await executeOperation(root, { op: "search", query: "retention", kb: "shared" });
    const sharedSearchResult = (sharedSearch.data as { results: Array<{ id: string; flags?: { disputed?: boolean } }> }).results.find((result) => result.id === sharedId);
    assert.equal(sharedSearchResult?.flags?.disputed, false);
    const localWhy = await executeOperation(root, { op: "why", nodeId: localId, kb: "adr" });
    assert.equal((localWhy.data as { reviews: Array<{ triggerId: string; status: string }> }).reviews.some((review) => review.triggerId === contradictedData.contradiction.id && review.status === "open"), true);
    const sharedReviews = await executeOperation(root, { op: "review", kb: "shared" });
    assert.equal((sharedReviews.data as { reviews: Array<{ triggerId: string }> }).reviews.some((review) => review.triggerId === contradictedData.contradiction.id), false);
    const siblingReviews = await executeOperation(root, { op: "review", kb: "research" });
    assert.equal((siblingReviews.data as { reviews: Array<{ triggerId: string }> }).reviews.some((review) => review.triggerId === contradictedData.contradiction.id), false);
    const sharedAudit = await executeOperation(root, { op: "audit", kb: "shared", evaluationTime: "2026-09-10T17:00:00Z" });
    assert.equal((sharedAudit.data as { findings: Array<{ category: string; contradictionId?: string }> }).findings.some((finding) => finding.category === "open_contradiction" && finding.contradictionId === contradictedData.contradiction.id), false);
    const localAudit = await executeOperation(root, { op: "audit", kb: "adr", evaluationTime: "2026-09-10T17:00:00Z" });
    assert.equal((localAudit.data as { findings: Array<{ category: string; contradictionId?: string }> }).findings.some((finding) => finding.category === "open_contradiction" && finding.contradictionId === contradictedData.contradiction.id), true);
    await executeOperation(root, { op: "export", kb: "shared" });
    const sharedDocument = await readFile(join(root, "kb", "shared", `${sharedId}.md`), "utf8");
    assert.equal(sharedDocument.includes(localId), false);
    assert.equal(sharedDocument.includes(contradictionRationale), false);
    await executeOperation(root, { op: "export", kb: "research" });
    const siblingDocument = await readFile(join(root, "kb", "shared", `${sharedId}.md`), "utf8");
    assert.equal(siblingDocument.includes(localId), false);
    assert.equal(siblingDocument.includes(contradictionRationale), false);

    await executeOperation(root, { op: "export", kb: "adr" });
    const localDocument = await readFile(join(root, "kb", "adr", `${localId}.md`), "utf8");
    const localClosing = localDocument.indexOf("\n---\n", 4);
    const localFrontmatter = parseDocument(localDocument.slice(4, localClosing)).toJSON() as {
      justification?: {
        contradictions?: Array<{ id: string; status: string; rationale: string; resolutionHistory?: Array<{ resolution: string }> }>;
        reviews?: Array<{ triggerId: string; status: string }>;
      };
    };
    const projectedConflict = localFrontmatter.justification?.contradictions?.find((conflict) => conflict.id === contradictedData.contradiction.id);
    assert.equal(projectedConflict?.status, "open");
    assert.equal(projectedConflict?.rationale, contradictionRationale);
    assert.equal(projectedConflict?.resolutionHistory?.at(-1)?.resolution, "unresolved");
    assert.equal(localFrontmatter.justification?.reviews?.some((review) => review.triggerId === contradictedData.contradiction.id && review.status === "open"), true);
    assert.equal(localDocument.includes("## Conflicts"), true);
    assert.equal(localDocument.includes(contradictionRationale), true);
    assert.equal(localDocument.includes("The shared policy and local ADR apply to different scopes."), true);
    assert.equal(localDocument.includes("The available records do not establish which statement should win."), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records scoped typed relationships, permits graph cycles, and keeps child edges out of shared traces", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-knowledge-actions-relate-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope"
    });
    await executeOperation(root, {
      op: "create_kb",
      id: "research",
      title: "Research",
      actor: "human:scope"
    });
    const shared = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared anchor",
      body: "A shared anchor for relationship visibility.",
      actor: "human:shared"
    });
    const sharedId = (shared.data as { node: { id: string } }).node.id;
    const first = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "ADR relationship first",
      body: "The first child node participates in a cycle.",
      actor: "human:adr"
    });
    const firstId = (first.data as { node: { id: string } }).node.id;
    const second = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "ADR relationship second",
      body: "The second child node participates in a cycle.",
      actor: "human:adr"
    });
    const secondId = (second.data as { node: { id: string } }).node.id;
    const sibling = await executeOperation(root, {
      op: "record",
      kb: "research",
      kind: "claim",
      title: "Sibling relationship target",
      body: "This node belongs to another child scope.",
      actor: "human:research"
    });
    const siblingId = (sibling.data as { node: { id: string } }).node.id;

    const firstRelation = await executeOperation(root, {
      op: "relate",
      kb: "adr",
      from: firstId,
      to: secondId,
      type: "references",
      rationale: "The first record references the second.",
      actor: "human:adr",
      at: "2026-09-10T17:00:00Z"
    });
    const firstRelationData = firstRelation.data as {
      relationship: { id: string; kb: string; from: string; to: string; type: string; rationale?: string };
      committed: boolean;
    };
    assert.equal(firstRelationData.committed, true);
    assert.deepEqual(firstRelationData.relationship, {
      id: firstRelationData.relationship.id,
      kb: "adr",
      from: firstId,
      to: secondId,
      type: "references",
      rationale: "The first record references the second.",
      createdBy: "human:adr",
      createdAt: "2026-09-10T17:00:00.000Z"
    });

    const secondRelation = await executeOperation(root, {
      op: "relate",
      kb: "adr",
      from: secondId,
      to: firstId,
      type: "depends_on",
      rationale: "The second record depends on the first.",
      actor: "human:adr",
      at: "2026-09-10T17:01:00Z",
      expectedRevision: firstRelation.revision
    });
    const secondRelationData = secondRelation.data as { relationship: { from: string; to: string; type: string } };
    assert.deepEqual(
      {
        from: secondRelationData.relationship.from,
        to: secondRelationData.relationship.to,
        type: secondRelationData.relationship.type
      },
      { from: secondId, to: firstId, type: "depends_on" }
    );

    const trace = await executeOperation(root, {
      op: "trace",
      nodeId: firstId,
      direction: "downstream",
      kb: "adr"
    });
    const traceData = trace.data as { results: Array<{ id: string; paths: string[][]; reasons: string[] }>; truncated: boolean };
    assert.equal(traceData.truncated, false);
    assert.deepEqual(traceData.results.map((result) => result.id), [secondId]);
    assert.deepEqual(traceData.results[0]?.paths, [[firstId, secondId]]);
    assert.deepEqual(traceData.results[0]?.reasons, ["typed relationship: depends_on"]);

    await assert.rejects(
      executeOperation(root, {
        op: "relate",
        kb: "adr",
        from: firstId,
        to: siblingId,
        type: "relevant_to",
        actor: "human:adr",
        expectedRevision: secondRelation.revision
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SCOPE_VIOLATION");
        return true;
      }
    );
    assert.equal((await executeOperation(root, { op: "knowledge_bases" })).revision, secondRelation.revision);

    const inheritedRelation = await executeOperation(root, {
      op: "relate",
      from: firstId,
      to: sharedId,
      type: "relevant_to",
      rationale: "The ADR node uses shared context.",
      actor: "human:adr",
      expectedRevision: secondRelation.revision
    });
    const inheritedRelationData = inheritedRelation.data as { relationship: { kb: string; from: string; to: string } };
    assert.deepEqual(
      {
        kb: inheritedRelationData.relationship.kb,
        from: inheritedRelationData.relationship.from,
        to: inheritedRelationData.relationship.to
      },
      { kb: "adr", from: firstId, to: sharedId }
    );

    const sharedTrace = await executeOperation(root, {
      op: "trace",
      nodeId: sharedId,
      direction: "downstream",
      kb: "shared"
    });
    const sharedTraceData = sharedTrace.data as { results: Array<{ id: string }> };
    assert.deepEqual(sharedTraceData.results, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
