import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { initializeProject } from "../src/index.ts";

const CREATED_AT = "2026-09-11T10:00:00Z";
const EVALUATION_TIME = "2026-09-11T12:00:00Z";
const ACTOR = "mcp:knowledge-actions";

const SHARED_ASSUMPTION_ID = "11111111-1111-4111-8111-111111111111";
const SHARED_CLAIM_ID = "22222222-2222-4222-8222-222222222222";
const LOCAL_CLAIM_ID = "33333333-3333-4333-8333-333333333333";
const ARTIFACT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_CLAIM_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_ARTIFACT_ID = "66666666-6666-4666-8666-666666666666";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

function success<T>(result: ToolResult): T {
  assert.equal(result.isError, undefined);
  assert.notEqual(result.structuredContent, undefined);
  return result.structuredContent as T;
}

function transport(cli: string, firstRoot: string, secondRoot: string): StdioClientTransport {
  return new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", firstRoot, secondRoot],
    stderr: "pipe"
  });
}

function envelopeBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

test("current MCP SDK exposes scoped knowledge actions and bounded queries", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-mcp-knowledge-actions-"));
  const firstRoot = join(parent, "first");
  const secondRoot = join(parent, "second");
  const cli = join(process.cwd(), "dist", "cli.js");
  let client: Client | undefined;

  try {
    const first = await initializeProject(firstRoot);
    const second = await initializeProject(secondRoot);

    client = new Client(
      { name: "justification-mcp-knowledge-actions", version: "0.0.1" },
      { versionNegotiation: { mode: "auto" } }
    );
    await client.connect(transport(cli, firstRoot, secondRoot));
    assert.equal(client.getProtocolEra(), "modern");
    assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");

    const advertised = await client.listTools();
    const toolsByName = new Map(advertised.tools.map((tool) => [tool.name, tool]));
    const expectedSchemas: Record<string, string[]> = {
      contradict: ["project_id", "left", "right", "rationale", "kb", "actor", "at", "expectedRevision"],
      conflicts: ["project_id", "kb"],
      review: ["project_id", "reviewId", "status", "rationale", "kb", "actor", "at", "expectedRevision"],
      resolve_conflict: ["project_id", "contradictionId", "resolution", "winnerId", "rationale", "kb", "actor", "at", "expectedRevision"],
      context: ["project_id", "nodeId", "query", "kb", "budget", "evaluationTime"],
      trace: ["project_id", "nodeId", "direction", "kb", "budget", "evaluationTime"]
    };
    for (const [name, properties] of Object.entries(expectedSchemas)) {
      const tool = toolsByName.get(name);
      assert.ok(tool, `MCP must advertise ${name}`);
      const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: readonly string[] };
      assert.ok(schema.properties, `${name} must advertise input properties`);
      for (const property of properties) {
        assert.equal(Object.prototype.hasOwnProperty.call(schema.properties, property), true, `${name} schema must advertise ${property}`);
      }
      assert.equal(schema.required?.includes("project_id"), true, `${name} must require project_id`);
    }

    const projects = success<{ projects: Array<{ id: string; root: string }> }>(
      await client.callTool({ name: "projects", arguments: {} })
    );
    assert.deepEqual(projects.projects.map(({ id, root }) => ({ id, root })), [
      { id: first.id, root: first.root },
      { id: second.id, root: second.root }
    ]);

    const firstKb = success<{
      revision: number;
      data: { knowledgeBase: { id: string; parent: string | null } };
    }>(await client.callTool({
      name: "create_kb",
      arguments: {
        project_id: first.id,
        id: "adr",
        title: "Architecture decision",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(firstKb.revision, 1);
    assert.deepEqual(firstKb.data.knowledgeBase, {
      id: "adr",
      parent: "shared",
      title: "Architecture decision",
      createdBy: ACTOR,
      createdAt: "2026-09-11T10:00:00.000Z",
      inherited: false,
      root: join(first.root, "kb", "adr")
    });

    const secondKb = success<{
      revision: number;
      data: { knowledgeBase: { id: string; parent: string | null } };
    }>(await client.callTool({
      name: "create_kb",
      arguments: {
        project_id: second.id,
        id: "research",
        title: "Independent research",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(secondKb.revision, 1);
    assert.deepEqual(secondKb.data.knowledgeBase, {
      id: "research",
      parent: "shared",
      title: "Independent research",
      createdBy: ACTOR,
      createdAt: "2026-09-11T10:00:00.000Z",
      inherited: false,
      root: join(second.root, "kb", "research")
    });

    const sharedAssumption = success<{ revision: number; data: { node: { id: string; kind: string; kb: string } } }>(await client.callTool({
      name: "record",
      arguments: {
        project_id: first.id,
        id: SHARED_ASSUMPTION_ID,
        kb: "shared",
        kind: "assumption",
        title: "The retained policy is applicable",
        body: "The retained policy applies to the architecture decision.",
        fields: { accepted: true },
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.deepEqual(sharedAssumption.data.node, {
      id: SHARED_ASSUMPTION_ID,
      kind: "assumption",
      kb: "shared",
      title: "The retained policy is applicable",
      body: "The retained policy applies to the architecture decision.",
      fields: { accepted: true },
      createdBy: ACTOR,
      createdAt: "2026-09-11T10:00:00.000Z"
    });

    const sharedClaim = success<{ revision: number; data: { node: { id: string; kind: string; kb: string } } }>(await client.callTool({
      name: "record",
      arguments: {
        project_id: first.id,
        id: SHARED_CLAIM_ID,
        kb: "shared",
        kind: "claim",
        title: "The policy requires retained support",
        body: "The shared policy requires retained support for the decision.",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.deepEqual(
      { id: sharedClaim.data.node.id, kind: sharedClaim.data.node.kind, kb: sharedClaim.data.node.kb },
      { id: SHARED_CLAIM_ID, kind: "claim", kb: "shared" }
    );

    const sharedJustification = success<{ revision: number; data: { justification: { conclusion: string; groups: Array<{ premises: string[] }> } } }>(await client.callTool({
      name: "justify",
      arguments: {
        project_id: first.id,
        kb: "shared",
        conclusion: SHARED_CLAIM_ID,
        groups: [[SHARED_ASSUMPTION_ID]],
        rationale: "The accepted shared assumption supports the policy claim.",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(sharedJustification.data.justification.conclusion, SHARED_CLAIM_ID);
    assert.deepEqual(sharedJustification.data.justification.groups[0]?.premises, [SHARED_ASSUMPTION_ID]);

    const localClaim = success<{ revision: number; data: { node: { id: string; kind: string; kb: string } } }>(await client.callTool({
      name: "record",
      arguments: {
        project_id: first.id,
        id: LOCAL_CLAIM_ID,
        kb: "adr",
        kind: "claim",
        title: "The ADR follows the retained policy",
        body: "The ADR proposal follows the retained shared policy.",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.deepEqual(
      { id: localClaim.data.node.id, kind: localClaim.data.node.kind, kb: localClaim.data.node.kb },
      { id: LOCAL_CLAIM_ID, kind: "claim", kb: "adr" }
    );

    const localJustification = success<{ revision: number; data: { justification: { conclusion: string; groups: Array<{ premises: string[] }> } } }>(await client.callTool({
      name: "justify",
      arguments: {
        project_id: first.id,
        kb: "adr",
        conclusion: LOCAL_CLAIM_ID,
        groups: [[SHARED_CLAIM_ID]],
        rationale: "The local ADR claim follows the inherited shared policy claim.",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(localJustification.data.justification.conclusion, LOCAL_CLAIM_ID);
    assert.deepEqual(localJustification.data.justification.groups[0]?.premises, [SHARED_CLAIM_ID]);

    const artifact = success<{
      revision: number;
      data: { node: { id: string; kind: string; kb: string; fields: { basis: string[] } } };
    }>(await client.callTool({
      name: "record",
      arguments: {
        project_id: first.id,
        id: ARTIFACT_ID,
        kb: "adr",
        kind: "artifact",
        title: "Architecture decision brief",
        body: "The architecture decision brief follows the retained policy.",
        basis: [LOCAL_CLAIM_ID],
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.deepEqual(
      {
        id: artifact.data.node.id,
        kind: artifact.data.node.kind,
        kb: artifact.data.node.kb,
        basis: artifact.data.node.fields.basis
      },
      { id: ARTIFACT_ID, kind: "artifact", kb: "adr", basis: [LOCAL_CLAIM_ID] }
    );

    const otherClaim = success<{ revision: number; data: { node: { id: string; kind: string; kb: string } } }>(await client.callTool({
      name: "record",
      arguments: {
        project_id: second.id,
        id: OTHER_CLAIM_ID,
        kb: "research",
        kind: "claim",
        title: "Independent research claim",
        body: "The independent research claim belongs only to the second project.",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.deepEqual(
      { id: otherClaim.data.node.id, kind: otherClaim.data.node.kind, kb: otherClaim.data.node.kb },
      { id: OTHER_CLAIM_ID, kind: "claim", kb: "research" }
    );
    const otherArtifact = success<{ revision: number; data: { node: { id: string; kind: string; kb: string } } }>(await client.callTool({
      name: "record",
      arguments: {
        project_id: second.id,
        id: OTHER_ARTIFACT_ID,
        kb: "research",
        kind: "artifact",
        title: "Independent research brief",
        body: "The independent research brief contains only second-project material.",
        basis: [OTHER_CLAIM_ID],
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.deepEqual(
      { id: otherArtifact.data.node.id, kind: otherArtifact.data.node.kind, kb: otherArtifact.data.node.kb },
      { id: OTHER_ARTIFACT_ID, kind: "artifact", kb: "research" }
    );

    const contradicted = success<{
      revision: number;
      data: {
        contradiction: {
          id: string;
          kb: string;
          left: string;
          right: string;
          rationale: string;
          status: string;
        };
        reviews: Array<{ id: string; nodeId: string; triggerId: string; triggerType: string; status: string }>;
        committed: boolean;
      };
    }>(await client.callTool({
      name: "contradict",
      arguments: {
        project_id: first.id,
        kb: "adr",
        left: SHARED_CLAIM_ID,
        right: LOCAL_CLAIM_ID,
        rationale: "The shared policy and local ADR claim require explicit reconciliation.",
        actor: ACTOR,
        at: "2026-09-11T10:01:00Z",
        expectedRevision: artifact.revision
      }
    }));
    const contradiction = contradicted.data.contradiction;
    const contradictionId = contradiction.id;
    assert.equal(contradicted.revision, artifact.revision + 1);
    assert.equal(contradicted.data.committed, true);
    assert.deepEqual(
      {
        kb: contradiction.kb,
        left: contradiction.left,
        right: contradiction.right,
        rationale: contradiction.rationale,
        status: contradiction.status
      },
      {
        kb: "adr",
        left: SHARED_CLAIM_ID,
        right: LOCAL_CLAIM_ID,
        rationale: "The shared policy and local ADR claim require explicit reconciliation.",
        status: "open"
      }
    );
    assert.equal(contradicted.data.reviews.length, 1);
    const contradictionReview = contradicted.data.reviews[0];
    assert.ok(contradictionReview);
    assert.deepEqual(
      {
        nodeId: contradictionReview.nodeId,
        triggerId: contradictionReview.triggerId,
        triggerType: contradictionReview.triggerType,
        status: contradictionReview.status
      },
      { nodeId: LOCAL_CLAIM_ID, triggerId: contradictionId, triggerType: "contradiction", status: "open" }
    );

    const sharedConflicts = success<{
      revision: number;
      data: { conflicts: Array<{ id: string }>; contradictions: Array<{ id: string }> };
    }>(await client.callTool({ name: "conflicts", arguments: { project_id: first.id, kb: "shared" } }));
    const childConflicts = success<{
      revision: number;
      data: { conflicts: Array<{ id: string; kb: string; left: string; right: string; status: string }>; contradictions: Array<{ id: string }> };
    }>(await client.callTool({ name: "conflicts", arguments: { project_id: first.id, kb: "adr" } }));
    const siblingConflicts = success<{
      revision: number;
      data: { conflicts: Array<{ id: string }>; contradictions: Array<{ id: string }> };
    }>(await client.callTool({ name: "conflicts", arguments: { project_id: second.id, kb: "research" } }));
    assert.equal(sharedConflicts.revision, contradicted.revision);
    assert.equal(childConflicts.revision, contradicted.revision);
    assert.equal(siblingConflicts.revision, otherArtifact.revision);
    assert.deepEqual(sharedConflicts.data.conflicts, []);
    assert.deepEqual(sharedConflicts.data.contradictions, []);
    assert.deepEqual(childConflicts.data.conflicts.map(({ id, kb, left, right, status }) => ({ id, kb, left, right, status })), [{
      id: contradictionId,
      kb: "adr",
      left: SHARED_CLAIM_ID,
      right: LOCAL_CLAIM_ID,
      status: "open"
    }]);
    assert.deepEqual(childConflicts.data.contradictions.map(({ id }) => id), [contradictionId]);
    assert.deepEqual(siblingConflicts.data.conflicts, []);
    assert.deepEqual(siblingConflicts.data.contradictions, []);

    const sharedReviews = success<{ revision: number; data: { reviews: Array<{ id: string }>; changes: unknown[] } }>(
      await client.callTool({ name: "review", arguments: { project_id: first.id, kb: "shared", status: "open" } })
    );
    const childReviews = success<{
      revision: number;
      data: { reviews: Array<{ id: string; nodeId: string; triggerId: string; triggerType: string; status: string }>; changes: unknown[] };
    }>(await client.callTool({ name: "review", arguments: { project_id: first.id, kb: "adr", status: "open" } }));
    const siblingReviews = success<{ revision: number; data: { reviews: Array<{ id: string }>; changes: unknown[] } }>(
      await client.callTool({ name: "review", arguments: { project_id: second.id, kb: "research", status: "open" } })
    );
    assert.equal(sharedReviews.revision, contradicted.revision);
    assert.equal(childReviews.revision, contradicted.revision);
    assert.equal(siblingReviews.revision, otherArtifact.revision);
    assert.deepEqual(sharedReviews.data.reviews, []);
    assert.deepEqual(childReviews.data.reviews.map(({ id, nodeId, triggerId, triggerType, status }) => ({ id, nodeId, triggerId, triggerType, status })), [{
      id: contradictionReview.id,
      nodeId: contradictionReview.nodeId,
      triggerId: contradictionReview.triggerId,
      triggerType: contradictionReview.triggerType,
      status: contradictionReview.status
    }]);
    assert.deepEqual(siblingReviews.data.reviews, []);

    const contextBeforeResolution = success<{
      revision: number;
      data: {
        scope: { kb: string | null };
        anchor: { id: string; kind: string };
        results: Array<{
          id: string;
          kb: string;
          kind: string;
          title: string;
          flags: { supported: boolean; assumed: boolean; disputed: boolean; pending: boolean };
          support: { status: string };
          reviewRequired: boolean;
          openReviewIds: string[];
        }>;
        truncated: boolean;
      };
    }>(await client.callTool({
      name: "context",
      arguments: {
        project_id: first.id,
        kb: "adr",
        nodeId: ARTIFACT_ID,
        budget: 4096,
        evaluationTime: EVALUATION_TIME
      }
    }));
    assert.equal(contextBeforeResolution.revision, contradicted.revision);
    assert.deepEqual(contextBeforeResolution.data.scope, { kb: "adr" });
    assert.deepEqual(contextBeforeResolution.data.anchor, { id: ARTIFACT_ID, kind: "artifact" });
    assert.equal(contextBeforeResolution.data.truncated, false);
    assert.deepEqual(contextBeforeResolution.data.results.map((entry) => ({
      id: entry.id,
      kb: entry.kb,
      kind: entry.kind,
      title: entry.title,
      flags: entry.flags,
      supportStatus: entry.support.status,
      reviewRequired: entry.reviewRequired,
      openReviewIds: entry.openReviewIds
    })), [
      {
        id: LOCAL_CLAIM_ID,
        kb: "adr",
        kind: "claim",
        title: "The ADR follows the retained policy",
        flags: { supported: true, assumed: false, disputed: true, pending: false },
        supportStatus: "usable",
        reviewRequired: true,
        openReviewIds: [contradictionReview.id]
      },
      {
        id: SHARED_CLAIM_ID,
        kb: "shared",
        kind: "claim",
        title: "The policy requires retained support",
        flags: { supported: true, assumed: false, disputed: true, pending: false },
        supportStatus: "usable",
        reviewRequired: false,
        openReviewIds: []
      },
      {
        id: SHARED_ASSUMPTION_ID,
        kb: "shared",
        kind: "assumption",
        title: "The retained policy is applicable",
        flags: { supported: true, assumed: true, disputed: false, pending: false },
        supportStatus: "usable",
        reviewRequired: false,
        openReviewIds: []
      }
    ]);
    assert.equal(contextBeforeResolution.data.results.some(({ id }) => id === OTHER_CLAIM_ID || id === OTHER_ARTIFACT_ID), false);
    assert.equal(envelopeBytes(contextBeforeResolution) <= 4096, true);

    const traceBeforeResolution = success<{
      revision: number;
      data: {
        scope: { kb: string | null };
        root: { id: string; kb: string; kind: string; title: string };
        direction: string;
        results: Array<{ id: string; paths: string[][]; reasons: string[] }>;
        truncated: boolean;
      };
    }>(await client.callTool({
      name: "trace",
      arguments: {
        project_id: first.id,
        kb: "adr",
        nodeId: ARTIFACT_ID,
        direction: "upstream",
        budget: 2048,
        evaluationTime: EVALUATION_TIME
      }
    }));
    assert.equal(traceBeforeResolution.revision, contradicted.revision);
    assert.deepEqual(traceBeforeResolution.data.scope, { kb: "adr" });
    assert.deepEqual(
      {
        id: traceBeforeResolution.data.root.id,
        kb: traceBeforeResolution.data.root.kb,
        kind: traceBeforeResolution.data.root.kind,
        title: traceBeforeResolution.data.root.title
      },
      { id: ARTIFACT_ID, kb: "adr", kind: "artifact", title: "Architecture decision brief" }
    );
    assert.equal(traceBeforeResolution.data.direction, "upstream");
    assert.equal(traceBeforeResolution.data.truncated, false);
    assert.deepEqual(new Map(traceBeforeResolution.data.results.map((entry) => [entry.id, { paths: entry.paths, reasons: entry.reasons }])), new Map([
      [SHARED_ASSUMPTION_ID, { paths: [[ARTIFACT_ID, LOCAL_CLAIM_ID, SHARED_CLAIM_ID, SHARED_ASSUMPTION_ID]], reasons: ["declared basis"] }],
      [SHARED_CLAIM_ID, { paths: [[ARTIFACT_ID, LOCAL_CLAIM_ID, SHARED_CLAIM_ID]], reasons: ["declared basis"] }],
      [LOCAL_CLAIM_ID, { paths: [[ARTIFACT_ID, LOCAL_CLAIM_ID]], reasons: ["declared basis"] }]
    ]));
    assert.equal(traceBeforeResolution.data.results.some(({ id }) => id === OTHER_CLAIM_ID || id === OTHER_ARTIFACT_ID), false);
    assert.equal(envelopeBytes(traceBeforeResolution) <= 2048, true);

    const boundedContext = success<{
      revision: number;
      data: { results: Array<{ id: string }>; truncated: boolean };
    }>(await client.callTool({
      name: "context",
      arguments: {
        project_id: first.id,
        kb: "adr",
        nodeId: ARTIFACT_ID,
        budget: 900,
        evaluationTime: EVALUATION_TIME
      }
    }));
    assert.equal(boundedContext.revision, contradicted.revision);
    assert.equal(boundedContext.data.truncated, true);
    assert.equal(boundedContext.data.results.length < contextBeforeResolution.data.results.length, true);
    assert.equal(boundedContext.data.results.every(({ id }) => contextBeforeResolution.data.results.some((entry) => entry.id === id)), true);
    assert.equal(envelopeBytes(boundedContext) <= 900, true);

    const boundedTrace = success<{
      revision: number;
      data: { results: Array<{ id: string }>; truncated: boolean };
    }>(await client.callTool({
      name: "trace",
      arguments: {
        project_id: first.id,
        kb: "adr",
        nodeId: ARTIFACT_ID,
        direction: "upstream",
        budget: 700,
        evaluationTime: EVALUATION_TIME
      }
    }));
    assert.equal(boundedTrace.revision, contradicted.revision);
    assert.equal(boundedTrace.data.truncated, true);
    assert.equal(boundedTrace.data.results.length < traceBeforeResolution.data.results.length, true);
    assert.equal(boundedTrace.data.results.every(({ id }) => traceBeforeResolution.data.results.some((entry) => entry.id === id)), true);
    assert.equal(envelopeBytes(boundedTrace) <= 700, true);

    const closedAt = "2026-09-11T10:02:00Z";
    const closureRationale = "Reviewed the explicit conflict and recorded the decision owner.";
    const closed = success<{
      revision: number;
      data: {
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
    }>(await client.callTool({
      name: "review",
      arguments: {
        project_id: first.id,
        kb: "adr",
        reviewId: contradictionReview.id,
        status: "closed",
        rationale: closureRationale,
        actor: ACTOR,
        at: closedAt,
        expectedRevision: contradicted.revision
      }
    }));
    assert.equal(closed.revision, contradicted.revision + 1);
    assert.equal(closed.data.committed, true);
    assert.equal(closed.data.idempotent, false);
    assert.deepEqual(
      {
        id: closed.data.review.id,
        nodeId: closed.data.review.nodeId,
        triggerId: closed.data.review.triggerId,
        status: closed.data.review.status,
        closedBy: closed.data.review.closedBy,
        closedAt: closed.data.review.closedAt,
        closureRationale: closed.data.review.closureRationale
      },
      {
        id: contradictionReview.id,
        nodeId: LOCAL_CLAIM_ID,
        triggerId: contradictionId,
        status: "closed",
        closedBy: ACTOR,
        closedAt: "2026-09-11T10:02:00.000Z",
        closureRationale
      }
    );
    assert.deepEqual(closed.data.review.closureHistory, [{
      status: "closed",
      actor: ACTOR,
      at: "2026-09-11T10:02:00.000Z",
      rationale: closureRationale
    }]);

    const conflictsBeforeRetry = success(await client.callTool({
      name: "conflicts",
      arguments: { project_id: first.id, kb: "adr" }
    }));
    const retry = success<{
      revision: number;
      data: { review: { closedAt?: string; closureHistory?: Array<unknown> }; committed: boolean; idempotent: boolean };
    }>(await client.callTool({
      name: "review",
      arguments: {
        project_id: first.id,
        kb: "adr",
        reviewId: contradictionReview.id,
        status: "closed",
        rationale: closureRationale,
        actor: ACTOR,
        expectedRevision: closed.revision
      }
    }));
    assert.equal(retry.revision, closed.revision);
    assert.equal(retry.data.committed, false);
    assert.equal(retry.data.idempotent, true);
    assert.equal(retry.data.review.closedAt, closed.data.review.closedAt);
    assert.deepEqual(retry.data.review.closureHistory, closed.data.review.closureHistory);
    assert.deepEqual(success(await client.callTool({
      name: "conflicts",
      arguments: { project_id: first.id, kb: "adr" }
    })), conflictsBeforeRetry);

    const resolved = success<{
      revision: number;
      data: {
        contradiction: {
          id: string;
          left: string;
          right: string;
          status: string;
          resolution?: string;
          winnerId?: string;
          resolvedBy?: string;
          resolvedAt?: string;
          resolutionRationale?: string;
          resolutionHistory?: Array<{ resolution: string; winnerId?: string; actor: string; at: string; rationale: string }>;
        };
        committed: boolean;
      };
    }>(await client.callTool({
      name: "resolve_conflict",
      arguments: {
        project_id: first.id,
        kb: "adr",
        contradictionId,
        resolution: "supersession",
        winnerId: LOCAL_CLAIM_ID,
        rationale: "The local ADR claim is the explicit decision for this scope.",
        actor: ACTOR,
        at: "2026-09-11T10:03:00Z",
        expectedRevision: retry.revision
      }
    }));
    assert.equal(resolved.revision, retry.revision + 1);
    assert.equal(resolved.data.committed, true);
    assert.deepEqual(
      {
        id: resolved.data.contradiction.id,
        left: resolved.data.contradiction.left,
        right: resolved.data.contradiction.right,
        status: resolved.data.contradiction.status,
        resolution: resolved.data.contradiction.resolution,
        winnerId: resolved.data.contradiction.winnerId,
        resolvedBy: resolved.data.contradiction.resolvedBy,
        resolvedAt: resolved.data.contradiction.resolvedAt,
        resolutionRationale: resolved.data.contradiction.resolutionRationale
      },
      {
        id: contradictionId,
        left: SHARED_CLAIM_ID,
        right: LOCAL_CLAIM_ID,
        status: "resolved",
        resolution: "supersession",
        winnerId: LOCAL_CLAIM_ID,
        resolvedBy: ACTOR,
        resolvedAt: "2026-09-11T10:03:00.000Z",
        resolutionRationale: "The local ADR claim is the explicit decision for this scope."
      }
    );
    assert.deepEqual(resolved.data.contradiction.resolutionHistory, [{
      resolution: "supersession",
      winnerId: LOCAL_CLAIM_ID,
      actor: ACTOR,
      at: "2026-09-11T10:03:00.000Z",
      rationale: "The local ADR claim is the explicit decision for this scope."
    }]);

    const finalChildConflicts = success<{
      revision: number;
      data: { conflicts: Array<{ id: string; status: string; winnerId?: string }>; contradictions: Array<{ id: string }> };
    }>(await client.callTool({ name: "conflicts", arguments: { project_id: first.id, kb: "adr" } }));
    const finalChildReviews = success<{
      revision: number;
      data: { reviews: Array<{ id: string; nodeId: string; triggerId: string; status: string; closedAt?: string }>; changes: unknown[] };
    }>(await client.callTool({ name: "review", arguments: { project_id: first.id, kb: "adr", status: "closed" } }));
    const finalSharedConflicts = success<{ revision: number; data: { conflicts: unknown[]; contradictions: unknown[] } }>(
      await client.callTool({ name: "conflicts", arguments: { project_id: first.id, kb: "shared" } })
    );
    const finalSiblingConflicts = success<{ revision: number; data: { conflicts: unknown[]; contradictions: unknown[] } }>(
      await client.callTool({ name: "conflicts", arguments: { project_id: second.id, kb: "research" } })
    );
    assert.equal(finalChildConflicts.revision, resolved.revision);
    assert.equal(finalChildReviews.revision, resolved.revision);
    assert.equal(finalSharedConflicts.revision, resolved.revision);
    assert.equal(finalSiblingConflicts.revision, otherArtifact.revision);
    assert.deepEqual(finalChildConflicts.data.conflicts.map(({ id, status, winnerId }) => ({ id, status, winnerId })), [{ id: contradictionId, status: "resolved", winnerId: LOCAL_CLAIM_ID }]);
    assert.deepEqual(finalChildConflicts.data.contradictions.map(({ id }) => id), [contradictionId]);
    assert.deepEqual(finalChildReviews.data.reviews.map(({ id, nodeId, triggerId, status, closedAt }) => ({ id, nodeId, triggerId, status, closedAt })), [{
      id: contradictionReview.id,
      nodeId: LOCAL_CLAIM_ID,
      triggerId: contradictionId,
      status: "closed",
      closedAt: "2026-09-11T10:02:00.000Z"
    }]);
    assert.deepEqual(finalSharedConflicts.data.conflicts, []);
    assert.deepEqual(finalSharedConflicts.data.contradictions, []);
    assert.deepEqual(finalSiblingConflicts.data.conflicts, []);
    assert.deepEqual(finalSiblingConflicts.data.contradictions, []);

    const otherTrace = success<{
      revision: number;
      data: { results: Array<{ id: string; paths: string[][] }>; truncated: boolean };
    }>(await client.callTool({
      name: "trace",
      arguments: {
        project_id: second.id,
        kb: "research",
        nodeId: OTHER_ARTIFACT_ID,
        direction: "upstream",
        budget: 2048,
        evaluationTime: EVALUATION_TIME
      }
    }));
    assert.equal(otherTrace.revision, otherArtifact.revision);
    assert.equal(otherTrace.data.truncated, false);
    assert.deepEqual(otherTrace.data.results.map(({ id, paths }) => ({ id, paths })), [{ id: OTHER_CLAIM_ID, paths: [[OTHER_ARTIFACT_ID, OTHER_CLAIM_ID]] }]);
    assert.equal(otherTrace.data.results.some(({ id }) => [SHARED_ASSUMPTION_ID, SHARED_CLAIM_ID, LOCAL_CLAIM_ID, ARTIFACT_ID].includes(id)), false);
  } finally {
    await client?.close().catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});
