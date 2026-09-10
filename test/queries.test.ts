import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { executeOperation, initializeProject } from "../src/index.ts";

test("search returns deterministic lexical hits within the whole-response UTF-8 byte budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-query-search-"));
  try {
    await initializeProject(root);
    const matched = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Café pilot",
      body: "The café pilot favors a weekly digest.",
      actor: "human:query-test",
      at: "2026-09-10T12:00:00Z"
    });
    const matchedId = (matched.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Tea pilot",
      body: "The tea pilot has no matching survey signal.",
      actor: "human:query-test",
      at: "2026-09-10T12:01:00Z"
    });

    const budget = 512;
    const response = await executeOperation(root, {
      op: "search",
      kb: "shared",
      query: "café",
      budget
    });
    const data = response.data as {
      query: string;
      scope: { kb: string | null };
      results: Array<{ id: string; kb: string; kind: string; title: string; snippet: string }>;
      truncated: boolean;
    };
    assert.equal(data.query, "café");
    assert.deepEqual(data.scope, { kb: "shared" });
    assert.equal(data.truncated, false);
    assert.deepEqual(data.results, [{
      id: matchedId,
      kb: "shared",
      kind: "claim",
      title: "Café pilot",
      snippet: "The café pilot favors a weekly digest.",
      flags: { supported: false, assumed: false, disputed: false, pending: true },
      support: { status: "pending", reason: "no declared support basis" },
      reviewRequired: false,
      openReviewIds: []
    }]);
    assert.ok(
      Buffer.byteLength(JSON.stringify({ revision: response.revision, data: response.data }), "utf8") <= budget,
      "the complete response envelope must fit the requested UTF-8 byte budget"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context puts supported direct claim knowledge before an output anchor", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-query-context-"));
  try {
    await initializeProject(root);
    const assumption = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "assumption",
      title: "The pilot audience can read the summary",
      body: "The fictional pilot audience can read a short summary.",
      fields: { accepted: true },
      actor: "human:query-test",
      at: "2026-09-10T12:00:00Z"
    });
    const assumptionId = (assumption.data as { node: { id: string } }).node.id;
    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "The pilot supports a café summary",
      body: "The accepted audience assumption supports the café summary.",
      actor: "human:query-test",
      at: "2026-09-10T12:01:00Z"
    });
    const claimId = (claim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: claimId,
      groups: [[assumptionId]],
      rationale: "The accepted audience assumption supports this claim.",
      actor: "human:query-test",
      at: "2026-09-10T12:02:00Z"
    });
    const artifact = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "artifact",
      title: "Café research brief",
      body: "A fictional brief based on the pilot claim.",
      basis: [claimId],
      actor: "human:query-test",
      at: "2026-09-10T12:03:00Z"
    });
    const artifactId = (artifact.data as { node: { id: string } }).node.id;

    const response = await executeOperation(root, {
      op: "context",
      kb: "shared",
      nodeId: artifactId,
      budget: 1024,
      evaluationTime: "2026-09-10T13:00:00Z"
    });
    const data = response.data as {
      scope: { kb: string | null };
      anchor: { id: string; kind: string };
      results: Array<{
        id: string;
        kb: string;
        kind: string;
        title: string;
        snippet: string;
        flags: { supported: boolean; assumed: boolean; disputed: boolean; pending: boolean };
        support: { status: string; reason: string };
      }>;
      truncated: boolean;
    };
    assert.deepEqual(data.scope, { kb: "shared" });
    assert.deepEqual(data.anchor, { id: artifactId, kind: "artifact" });
    assert.equal(data.truncated, false);
    assert.deepEqual(data.results.map((entry) => ({
      id: entry.id,
      kb: entry.kb,
      kind: entry.kind,
      title: entry.title,
      snippet: entry.snippet,
      flags: entry.flags,
      supportStatus: entry.support.status
    })), [
      {
        id: claimId,
        kb: "shared",
        kind: "claim",
        title: "The pilot supports a café summary",
        snippet: "The accepted audience assumption supports the café summary.",
        flags: { supported: true, assumed: false, disputed: false, pending: false },
        supportStatus: "usable"
      },
      {
        id: assumptionId,
        kb: "shared",
        kind: "assumption",
        title: "The pilot audience can read the summary",
        snippet: "The fictional pilot audience can read a short summary.",
        flags: { supported: true, assumed: true, disputed: false, pending: false },
        supportStatus: "usable"
      }
    ]);
    assert.ok(
      Buffer.byteLength(JSON.stringify({ revision: response.revision, data: response.data }), "utf8") <= 1024,
      "the complete context response must fit its UTF-8 byte budget"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("trace follows declared upstream support with inclusive deterministic paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-query-trace-"));
  try {
    await initializeProject(root);
    const assumption = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "assumption",
      title: "The pilot audience can read the summary",
      body: "The fictional pilot audience can read a short summary.",
      fields: { accepted: true },
      actor: "human:query-test",
      at: "2026-09-10T12:00:00Z"
    });
    const assumptionId = (assumption.data as { node: { id: string } }).node.id;
    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "The pilot supports a café summary",
      body: "The accepted audience assumption supports the café summary.",
      actor: "human:query-test",
      at: "2026-09-10T12:01:00Z"
    });
    const claimId = (claim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: claimId,
      groups: [[assumptionId]],
      rationale: "The accepted audience assumption supports this claim.",
      actor: "human:query-test",
      at: "2026-09-10T12:02:00Z"
    });
    const artifact = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "artifact",
      title: "Café research brief",
      body: "A fictional brief based on the pilot claim.",
      basis: [claimId],
      actor: "human:query-test",
      at: "2026-09-10T12:03:00Z"
    });
    const artifactId = (artifact.data as { node: { id: string } }).node.id;

    const response = await executeOperation(root, {
      op: "trace",
      kb: "shared",
      nodeId: artifactId,
      direction: "upstream",
      budget: 2048
    });
    const data = response.data as {
      scope: { kb: string | null };
      root: { id: string; kb: string; kind: string; title: string; snippet: string };
      direction: string;
      results: Array<{ id: string; paths: string[][]; reasons: string[] }>;
      truncated: boolean;
    };
    assert.deepEqual(data.scope, { kb: "shared" });
    assert.deepEqual(data.root, {
      id: artifactId,
      kb: "shared",
      kind: "artifact",
      title: "Café research brief",
      snippet: "A fictional brief based on the pilot claim."
    });
    assert.equal(data.direction, "upstream");
    assert.equal(data.truncated, false);
    assert.deepEqual(new Map(data.results.map((entry) => [entry.id, { paths: entry.paths, reasons: entry.reasons }])), new Map([
      [claimId, { paths: [[artifactId, claimId]], reasons: ["declared basis"] }],
      [assumptionId, { paths: [[artifactId, claimId, assumptionId]], reasons: ["declared basis"] }]
    ]));
    assert.ok(
      Buffer.byteLength(JSON.stringify({ revision: response.revision, data: response.data }), "utf8") <= 2048,
      "the complete trace response must fit the requested UTF-8 byte budget"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("query summaries preserve open source reviews beside usable alternative support", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-query-review-"));
  try {
    await initializeProject(root);
    await writeFile(join(root, "constraints.md"), "The original source statement supports the retained finding.\n", "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      locator: "constraints.md",
      kb: "shared",
      actor: "human:query-test",
      at: "2026-09-10T12:00:00Z"
    });
    const capturedData = captured.data as {
      source: { id: string };
      evidence: { id: string };
    };
    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Retained finding",
      body: "The original source supports the retained finding.",
      actor: "human:query-test",
      at: "2026-09-10T12:01:00Z"
    });
    const claimId = (claim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: claimId,
      groups: [[capturedData.evidence.id]],
      rationale: "The retained evidence supports the finding.",
      actor: "human:query-test",
      at: "2026-09-10T12:02:00Z"
    });
    const assumption = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "assumption",
      title: "The fallback pilot signal remains applicable",
      body: "The fallback pilot signal remains applicable to this finding.",
      fields: { accepted: true },
      actor: "human:query-test",
      at: "2026-09-10T12:03:00Z"
    });
    const assumptionId = (assumption.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: claimId,
      groups: [[assumptionId]],
      rationale: "The accepted fallback assumption is an independent alternative.",
      actor: "human:query-test",
      at: "2026-09-10T12:04:00Z"
    });
    const artifact = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "artifact",
      title: "Research brief",
      body: "A brief based on the retained finding.",
      basis: [claimId],
      actor: "human:query-test",
      at: "2026-09-10T12:05:00Z"
    });
    const artifactId = (artifact.data as { node: { id: string } }).node.id;

    await writeFile(join(root, "constraints.md"), "The revised source statement needs review.\n", "utf8");
    const refreshed = await executeOperation(root, {
      op: "refresh",
      sourceIds: [capturedData.source.id],
      kb: "shared",
      actor: "human:query-test",
      at: "2026-09-10T12:06:00Z",
      evaluationTime: "2026-09-10T12:06:00Z"
    });
    const refreshData = refreshed.data as {
      changed: boolean;
      changes: Array<{ id: string }>;
      reviews: Array<{ id: string; nodeId: string; status: string; triggerId: string }>;
    };
    assert.equal(refreshData.changed, true);
    assert.equal(refreshData.changes.length, 1);
    const claimReview = refreshData.reviews.find((review) => review.nodeId === claimId && review.status === "open");
    assert.ok(claimReview, "the changed source must create an open review for the affected claim");
    assert.equal(claimReview.triggerId, refreshData.changes[0].id);

    const response = await executeOperation(root, {
      op: "context",
      nodeId: artifactId,
      kb: "shared",
      budget: 4096,
      evaluationTime: "2026-09-10T13:00:00Z"
    });
    const data = response.data as {
      results: Array<{
        id: string;
        flags: { supported: boolean; pending: boolean };
        support: { status: string };
        reviewRequired: boolean;
        openReviewIds: string[];
      }>;
    };
    const claimResult = data.results.find((result) => result.id === claimId);
    assert.ok(claimResult, "context should retain the affected claim");
    assert.deepEqual({
      supported: claimResult.flags.supported,
      pending: claimResult.flags.pending,
      supportStatus: claimResult.support.status,
      reviewRequired: claimResult.reviewRequired,
      openReviewIds: claimResult.openReviewIds
    }, {
      supported: true,
      pending: false,
      supportStatus: "usable",
      reviewRequired: true,
      openReviewIds: [claimReview.id]
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("near-boundary multibyte query budgets truncate every projection and reject below minimum", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-query-boundary-"));
  try {
    await initializeProject(root);
    const multibyteBody = Array.from({ length: 240 }, (_, index) => index % 2 === 0 ? "é" : "🧪").join("");
    const claimIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const claim = await executeOperation(root, {
        op: "record",
        kb: "shared",
        kind: "claim",
        title: `Café finding ${index}`,
        body: `Café ${multibyteBody}`,
        actor: "human:query-test",
        at: `2026-09-10T12:0${index}:00Z`
      });
      claimIds.push((claim.data as { node: { id: string } }).node.id);
    }
    const artifact = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "artifact",
      title: "Research output",
      body: "A bounded artifact output.",
      basis: claimIds,
      actor: "human:query-test",
      at: "2026-09-10T12:10:00Z"
    });
    const artifactId = (artifact.data as { node: { id: string } }).node.id;
    const budget = 1200;

    const search = await executeOperation(root, { op: "search", kb: "shared", query: "café", budget });
    const context = await executeOperation(root, { op: "context", kb: "shared", nodeId: artifactId, budget });
    const trace = await executeOperation(root, { op: "trace", kb: "shared", nodeId: artifactId, budget });
    for (const response of [search, context, trace]) {
      const data = response.data as { results: readonly unknown[]; truncated: boolean };
      assert.equal(data.truncated, true);
      assert.equal(data.results.length, 1, "the fixed budget should retain one large multibyte result");
      assert.ok(
        Buffer.byteLength(JSON.stringify(response), "utf8") <= budget,
        "the complete UTF-8 response envelope must fit the fixed budget"
      );
    }
    assert.equal((search.data as { results: readonly unknown[] }).results.length < 4, true);
    assert.equal((context.data as { results: readonly unknown[] }).results.length < claimIds.length, true);
    assert.equal((trace.data as { results: readonly unknown[] }).results.length < claimIds.length, true);

    const tooSmallRequests = [
      { op: "search" as const, kb: "shared", query: "café", budget: 1 },
      { op: "context" as const, kb: "shared", nodeId: artifactId, budget: 1 },
      { op: "trace" as const, kb: "shared", nodeId: artifactId, budget: 1 }
    ];
    for (const request of tooSmallRequests) {
      await assert.rejects(
        executeOperation(root, request),
        (error: unknown) => {
          const typed = error as { name?: string; code?: string; details?: { minimumBudget?: unknown } };
          assert.equal(typed.name, "QueryError");
          assert.equal(typed.code, "INVALID_REQUEST");
          assert.equal(typeof typed.details?.minimumBudget, "number");
          return true;
        }
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scoped queries isolate child disputes and reviews while tracing typed cycles finitely", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-query-scope-cycle-"));
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:scope",
      at: "2026-09-10T12:00:00Z"
    });
    await executeOperation(root, {
      op: "create_kb",
      id: "research",
      title: "Research",
      actor: "human:scope",
      at: "2026-09-10T12:01:00Z"
    });
    const sharedPolicy = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared policy",
      body: "The shared policy is the common reference point.",
      actor: "human:shared",
      at: "2026-09-10T12:02:00Z"
    });
    const sharedPolicyId = (sharedPolicy.data as { node: { id: string } }).node.id;
    const sharedPeer = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared policy alternative",
      body: "The shared policy alternative is also recorded.",
      actor: "human:shared",
      at: "2026-09-10T12:03:00Z"
    });
    const sharedPeerId = (sharedPeer.data as { node: { id: string } }).node.id;
    const childAOne = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "ADR policy node",
      body: "The ADR child policy node participates in a typed cycle.",
      actor: "human:adr",
      at: "2026-09-10T12:04:00Z"
    });
    const childAOneId = (childAOne.data as { node: { id: string } }).node.id;
    const childATwo = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "ADR cycle node",
      body: "The ADR child cycle node closes the typed loop.",
      actor: "human:adr",
      at: "2026-09-10T12:05:00Z"
    });
    const childATwoId = (childATwo.data as { node: { id: string } }).node.id;
    const childBOne = await executeOperation(root, {
      op: "record",
      kb: "research",
      kind: "claim",
      title: "Research policy node",
      body: "The research child policy node belongs to a sibling scope.",
      actor: "human:research",
      at: "2026-09-10T12:06:00Z"
    });
    const childBOneId = (childBOne.data as { node: { id: string } }).node.id;

    const sharedConflict = await executeOperation(root, {
      op: "contradict",
      kb: "shared",
      left: sharedPolicyId,
      right: sharedPeerId,
      rationale: "The shared policy records an open disagreement.",
      actor: "human:reviewer",
      at: "2026-09-10T12:07:00Z"
    });
    const sharedConflictData = sharedConflict.data as {
      contradiction: { id: string; kb: string; status: string };
      reviews: Array<{ id: string; nodeId: string; triggerId: string; status: string }>;
    };
    assert.equal(sharedConflictData.contradiction.kb, "shared");
    assert.equal(sharedConflictData.contradiction.status, "open");
    const sharedPolicyReview = sharedConflictData.reviews.find((review) => review.nodeId === sharedPolicyId);
    const sharedPeerReview = sharedConflictData.reviews.find((review) => review.nodeId === sharedPeerId);
    assert.ok(sharedPolicyReview);
    assert.ok(sharedPeerReview);

    const childConflict = await executeOperation(root, {
      op: "contradict",
      kb: "adr",
      left: sharedPolicyId,
      right: childAOneId,
      rationale: "The ADR policy node conflicts with the shared policy in this child scope.",
      actor: "human:reviewer",
      at: "2026-09-10T12:08:00Z"
    });
    const childConflictData = childConflict.data as {
      contradiction: { id: string; kb: string; status: string };
      reviews: Array<{ id: string; nodeId: string; triggerId: string; status: string }>;
    };
    assert.equal(childConflictData.contradiction.kb, "adr");
    assert.equal(childConflictData.contradiction.status, "open");
    assert.deepEqual(childConflictData.reviews.map((review) => review.nodeId), [childAOneId]);
    const childReview = childConflictData.reviews[0];
    assert.ok(childReview);

    const sharedArtifact = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "artifact",
      title: "Shared brief",
      body: "A shared output for context checks.",
      basis: [sharedPolicyId, sharedPeerId],
      actor: "human:shared",
      at: "2026-09-10T12:09:00Z"
    });
    const sharedArtifactId = (sharedArtifact.data as { node: { id: string } }).node.id;
    const childAArtifact = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "artifact",
      title: "ADR brief",
      body: "An ADR output for context checks.",
      basis: [sharedPolicyId, childAOneId],
      actor: "human:adr",
      at: "2026-09-10T12:10:00Z"
    });
    const childAArtifactId = (childAArtifact.data as { node: { id: string } }).node.id;
    const childBArtifact = await executeOperation(root, {
      op: "record",
      kb: "research",
      kind: "artifact",
      title: "Research brief",
      body: "A research output for context checks.",
      basis: [sharedPolicyId, childBOneId],
      actor: "human:research",
      at: "2026-09-10T12:11:00Z"
    });
    const childBArtifactId = (childBArtifact.data as { node: { id: string } }).node.id;

    let revision = childBArtifact.revision;
    const firstRelation = await executeOperation(root, {
      op: "relate",
      kb: "adr",
      from: childAOneId,
      to: childATwoId,
      type: "references",
      rationale: "The first ADR node references the second.",
      actor: "human:adr",
      at: "2026-09-10T12:12:00Z",
      expectedRevision: revision
    });
    revision = firstRelation.revision;
    const secondRelation = await executeOperation(root, {
      op: "relate",
      kb: "adr",
      from: childATwoId,
      to: childAOneId,
      type: "depends_on",
      rationale: "The second ADR node depends on the first.",
      actor: "human:adr",
      at: "2026-09-10T12:13:00Z",
      expectedRevision: revision
    });
    revision = secondRelation.revision;
    await executeOperation(root, {
      op: "relate",
      kb: "adr",
      from: childAOneId,
      to: sharedPolicyId,
      type: "supports",
      rationale: "The ADR cycle refers to the shared policy.",
      actor: "human:adr",
      at: "2026-09-10T12:14:00Z",
      expectedRevision: revision
    });

    const searchData = async (kb: string) => {
      const response = await executeOperation(root, { op: "search", kb, query: "policy" });
      return response.data as {
        results: Array<{
          id: string;
          flags: { disputed: boolean };
          reviewRequired: boolean;
          openReviewIds: string[];
        }>;
      };
    };
    const sharedSearch = await searchData("shared");
    const childASearch = await searchData("adr");
    const childBSearch = await searchData("research");
    assert.deepEqual(sharedSearch.results.map((result) => result.id).sort(), [sharedPeerId, sharedPolicyId].sort());
    assert.deepEqual(childASearch.results.map((result) => result.id).sort(), [sharedPeerId, sharedPolicyId, childAOneId].sort());
    assert.deepEqual(childBSearch.results.map((result) => result.id).sort(), [sharedPeerId, sharedPolicyId, childBOneId].sort());
    assert.equal(childASearch.results.some((result) => result.id === childBOneId), false);
    assert.equal(childBSearch.results.some((result) => result.id === childAOneId), false);
    assert.equal(sharedSearch.results.some((result) => result.id === childAOneId || result.id === childBOneId), false);
    const searchFlags = new Map(childASearch.results.map((result) => [result.id, result]));
    assert.deepEqual({
      disputed: searchFlags.get(sharedPolicyId)?.flags.disputed,
      reviewRequired: searchFlags.get(sharedPolicyId)?.reviewRequired,
      openReviewIds: searchFlags.get(sharedPolicyId)?.openReviewIds,
      childDisputed: searchFlags.get(childAOneId)?.flags.disputed,
      childReviewRequired: searchFlags.get(childAOneId)?.reviewRequired,
      childOpenReviewIds: searchFlags.get(childAOneId)?.openReviewIds
    }, {
      disputed: true,
      reviewRequired: true,
      openReviewIds: [sharedPolicyReview.id],
      childDisputed: true,
      childReviewRequired: true,
      childOpenReviewIds: [childReview.id]
    });
    const siblingFlags = new Map(childBSearch.results.map((result) => [result.id, result]));
    assert.deepEqual({
      disputed: siblingFlags.get(childBOneId)?.flags.disputed,
      reviewRequired: siblingFlags.get(childBOneId)?.reviewRequired,
      openReviewIds: siblingFlags.get(childBOneId)?.openReviewIds
    }, { disputed: false, reviewRequired: false, openReviewIds: [] });
    const sharedFlags = new Map(sharedSearch.results.map((result) => [result.id, result]));
    assert.deepEqual({
      disputed: sharedFlags.get(sharedPolicyId)?.flags.disputed,
      reviewRequired: sharedFlags.get(sharedPolicyId)?.reviewRequired,
      openReviewIds: sharedFlags.get(sharedPolicyId)?.openReviewIds
    }, { disputed: true, reviewRequired: true, openReviewIds: [sharedPolicyReview.id] });

    const contextData = async (kb: string, nodeId: string) => {
      const response = await executeOperation(root, { op: "context", kb, nodeId });
      return response.data as {
        results: Array<{
          id: string;
          flags: { disputed: boolean };
          reviewRequired: boolean;
          openReviewIds: string[];
        }>;
      };
    };
    const sharedContext = await contextData("shared", sharedArtifactId);
    const childAContext = await contextData("adr", childAArtifactId);
    const childBContext = await contextData("research", childBArtifactId);
    assert.deepEqual(sharedContext.results.map((result) => result.id).sort(), [sharedPeerId, sharedPolicyId].sort());
    assert.deepEqual(childAContext.results.map((result) => result.id).sort(), [sharedPolicyId, childAOneId].sort());
    assert.deepEqual(childBContext.results.map((result) => result.id).sort(), [sharedPolicyId, childBOneId].sort());
    assert.equal(childAContext.results.some((result) => result.id === childBOneId), false);
    assert.equal(childBContext.results.some((result) => result.id === childAOneId), false);
    const contextFlags = new Map(childAContext.results.map((result) => [result.id, result]));
    assert.deepEqual({
      sharedDisputed: contextFlags.get(sharedPolicyId)?.flags.disputed,
      sharedReviewRequired: contextFlags.get(sharedPolicyId)?.reviewRequired,
      sharedOpenReviewIds: contextFlags.get(sharedPolicyId)?.openReviewIds,
      childDisputed: contextFlags.get(childAOneId)?.flags.disputed,
      childReviewRequired: contextFlags.get(childAOneId)?.reviewRequired,
      childOpenReviewIds: contextFlags.get(childAOneId)?.openReviewIds
    }, {
      sharedDisputed: true,
      sharedReviewRequired: true,
      sharedOpenReviewIds: [sharedPolicyReview.id],
      childDisputed: true,
      childReviewRequired: true,
      childOpenReviewIds: [childReview.id]
    });

    const upstream = await executeOperation(root, { op: "trace", kb: "adr", nodeId: childAOneId, direction: "upstream" });
    const upstreamData = upstream.data as {
      results: Array<{ id: string; paths: string[][]; reasons: string[] }>;
    };
    assert.deepEqual(new Map(upstreamData.results.map((result) => [result.id, { paths: result.paths, reasons: result.reasons }])), new Map([
      [childATwoId, { paths: [[childAOneId, childATwoId]], reasons: ["typed relationship: references"] }],
      [sharedPolicyId, { paths: [[childAOneId, sharedPolicyId]], reasons: ["typed relationship: supports"] }]
    ]));
    assert.equal(upstreamData.results.some((result) => result.id === childBOneId || result.id === childBArtifactId), false);

    const downstream = await executeOperation(root, { op: "trace", kb: "adr", nodeId: childAOneId, direction: "downstream" });
    const downstreamData = downstream.data as {
      results: Array<{ id: string; paths: string[][]; reasons: string[] }>;
    };
    assert.deepEqual(new Map(downstreamData.results.map((result) => [result.id, { paths: result.paths, reasons: result.reasons }])), new Map([
      [childATwoId, { paths: [[childAOneId, childATwoId]], reasons: ["typed relationship: depends_on"] }],
      [childAArtifactId, { paths: [[childAOneId, childAArtifactId]], reasons: ["declared basis"] }]
    ]));
    assert.equal(downstreamData.results.some((result) => result.id === childAOneId), false, "cycle traversal must not repeat its root");

    const sharedTrace = await executeOperation(root, { op: "trace", kb: "shared", nodeId: sharedPolicyId, direction: "downstream" });
    const sharedTraceData = sharedTrace.data as { results: Array<{ id: string }> };
    assert.deepEqual(sharedTraceData.results.map((result) => result.id), [sharedArtifactId]);
    assert.equal(sharedTraceData.results.some((result) => result.id === childAOneId || result.id === childBOneId), false);
    const siblingTrace = await executeOperation(root, { op: "trace", kb: "research", nodeId: sharedPolicyId, direction: "downstream" });
    const siblingTraceData = siblingTrace.data as { results: Array<{ id: string }> };
    assert.deepEqual(new Set(siblingTraceData.results.map((result) => result.id)), new Set([sharedArtifactId, childBArtifactId]));
    assert.equal(siblingTraceData.results.some((result) => result.id === childAArtifactId || result.id === childAOneId), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
