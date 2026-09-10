import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { initializeProject } from "../src/index.ts";

const CREATED_AT = "2026-01-01T00:00:00Z";
const FIXED_EVALUATION_TIME = "2026-01-02T00:00:00Z";
const REFRESH_AT = "2026-01-03T00:00:00Z";
const REBUILD_AT = "2026-01-04T00:00:00Z";
const ACTOR = "mcp:maintenance";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

type WhyPayload = {
  revision: number;
  data: {
    node: { id: string; kind: string; body: string };
    evaluationTime: string;
    support: { status: string };
    originalBasis: {
      justification: { conclusion: string; groups: Array<{ premises: string[] }> };
      recordedAtRevision: number | null;
    } | null;
    upstream: Array<{ id: string }>;
    provenance: Array<{
      sourceId: string;
      observationId: string;
      observedText: string;
      providerRevision: string;
    }>;
    reviews: Array<{ nodeId: string; status: string }>;
    changes: Array<{ id: string }>;
    evidence: Array<{ id: string; observationId: string }>;
    observations: Array<{ id: string }>;
  };
};

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

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(
    lstat(path),
    (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    }
  );
}

test("current MCP SDK preserves maintenance state across refresh and rebuild", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-mcp-maintenance-"));
  const firstRoot = join(parent, "first");
  const secondRoot = join(parent, "second");
  const cli = join(process.cwd(), "dist", "cli.js");
  let client: Client | undefined;
  let restartedClient: Client | undefined;

  const sourceLocator = "sources/benchmark.md";
  const artifactLocator = "research/result.md";
  const initialText = "# Benchmark source\n\nResult: PASS.\n";
  const changedText = "# Benchmark source\n\nResult: FAIL after refresh.\n";
  const artifactText = "# Research result\n\nThe retained benchmark initially passed.\n";
  const initialDigest = createHash("sha256").update(initialText, "utf8").digest("hex");
  const changedDigest = createHash("sha256").update(changedText, "utf8").digest("hex");
  const artifactDigest = createHash("sha256").update(artifactText, "utf8").digest("hex");

  try {
    const first = await initializeProject(firstRoot);
    const second = await initializeProject(secondRoot);
    await mkdir(join(firstRoot, "sources"), { recursive: true });
    await mkdir(join(firstRoot, "research"), { recursive: true });
    await writeFile(join(firstRoot, sourceLocator), initialText, "utf8");
    await writeFile(join(firstRoot, artifactLocator), artifactText, "utf8");

    client = new Client(
      { name: "justification-mcp-maintenance", version: "0.0.1" },
      { versionNegotiation: { mode: "auto" } }
    );
    await client.connect(transport(cli, firstRoot, secondRoot));
    assert.equal(client.getProtocolEra(), "modern");
    assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");

    const projects = success<{ projects: Array<{ id: string; root: string }> }>(
      await client.callTool({ name: "projects", arguments: {} })
    );
    assert.deepEqual(projects.projects.map(({ id, root }) => ({ id, root })), [
      { id: first.id, root: first.root },
      { id: second.id, root: second.root }
    ]);

    const created = success<{
      revision: number;
      data: { knowledgeBase: { id: string; parent: string | null; root: string } };
    }>(await client.callTool({
      name: "create_kb",
      arguments: {
        project_id: first.id,
        id: "research",
        title: "Research knowledge",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(created.revision, 1);
    assert.deepEqual(
      {
        id: created.data.knowledgeBase.id,
        parent: created.data.knowledgeBase.parent,
        root: created.data.knowledgeBase.root
      },
      { id: "research", parent: "shared", root: join(first.root, "kb", "research") }
    );

    const captured = success<{
      revision: number;
      data: {
        source: { id: string; nodeId: string; kb: string; locator: string };
        observation: {
          id: string;
          sourceId: string;
          observedText: string;
          digest: string;
          observedBytesDigest: string;
          providerRevision: string;
          availability: string;
        };
        evidence: { id: string; sourceId: string; observationId: string };
      };
    }>(await client.callTool({
      name: "capture_source",
      arguments: {
        project_id: first.id,
        kb: "research",
        locator: sourceLocator,
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(captured.revision, 2);
    assert.equal(captured.data.source.kb, "research");
    assert.equal(captured.data.source.locator, sourceLocator);
    assert.equal(captured.data.observation.sourceId, captured.data.source.id);
    assert.equal(captured.data.observation.observedText, initialText);
    assert.equal(captured.data.observation.digest, initialDigest);
    assert.equal(captured.data.observation.observedBytesDigest, initialDigest);
    assert.equal(captured.data.observation.providerRevision, `sha256:${initialDigest}`);
    assert.equal(captured.data.observation.availability, "present");
    assert.equal(captured.data.evidence.sourceId, captured.data.source.id);
    assert.equal(captured.data.evidence.observationId, captured.data.observation.id);

    const evidence = success<{
      revision: number;
      data: {
        source: { id: string };
        observations: Array<{ id: string; sourceId: string; digest: string }>;
        evidence: Array<{ id: string; sourceId: string; observationId: string }>;
        changes: Array<{ id: string }>;
      };
    }>(await client.callTool({
      name: "evidence",
      arguments: {
        project_id: first.id,
        kb: "research",
        evidenceId: captured.data.evidence.id
      }
    }));
    assert.equal(evidence.revision, captured.revision);
    assert.equal(evidence.data.source.id, captured.data.source.id);
    assert.deepEqual(
      evidence.data.observations.map(({ id, sourceId, digest }) => ({ id, sourceId, digest })),
      [{ id: captured.data.observation.id, sourceId: captured.data.source.id, digest: initialDigest }]
    );
    assert.deepEqual(
      evidence.data.evidence.map(({ id, sourceId, observationId }) => ({ id, sourceId, observationId })),
      [{
        id: captured.data.evidence.id,
        sourceId: captured.data.evidence.sourceId,
        observationId: captured.data.evidence.observationId
      }]
    );
    assert.deepEqual(evidence.data.changes, []);

    const claim = success<{
      revision: number;
      data: { node: { id: string; kind: string; kb: string; body: string } };
    }>(await client.callTool({
      name: "record",
      arguments: {
        project_id: first.id,
        kb: "research",
        kind: "claim",
        title: "The benchmark initially passed",
        body: "The retained benchmark source reports a passing result.",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    const claimId = claim.data.node.id;
    assert.equal(claim.data.node.kind, "claim");
    assert.equal(claim.data.node.kb, "research");

    const justified = success<{
      revision: number;
      data: { justification: { id: string; conclusion: string; groups: Array<{ premises: string[] }> } };
    }>(await client.callTool({
      name: "justify",
      arguments: {
        project_id: first.id,
        kb: "research",
        conclusion: claimId,
        groups: [[captured.data.evidence.id]],
        rationale: "The retained benchmark observation supports the claim.",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(justified.data.justification.conclusion, claimId);
    assert.deepEqual(justified.data.justification.groups[0]?.premises, [captured.data.evidence.id]);

    const artifact = success<{
      revision: number;
      data: {
        node: {
          id: string;
          kind: string;
          kb: string;
          body: string;
          fields: {
            basis: string[];
            locator: string;
            digest: string;
            observedBytesDigest: string;
            originalBasisJustificationId: string;
            recordedAtRevision: number;
          };
        };
        justification: { id: string; conclusion: string; groups: Array<{ premises: string[] }> };
      };
    }>(await client.callTool({
      name: "record",
      arguments: {
        project_id: first.id,
        kb: "research",
        kind: "artifact",
        title: "Generic research result",
        body: artifactText,
        basis: [claimId],
        fields: { locator: artifactLocator },
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    const artifactId = artifact.data.node.id;
    assert.equal(artifact.data.node.kind, "artifact");
    assert.equal(artifact.data.node.kb, "research");
    assert.equal(artifact.data.node.body, artifactText);
    assert.deepEqual(artifact.data.node.fields.basis, [claimId]);
    assert.equal(artifact.data.node.fields.locator, artifactLocator);
    assert.equal(artifact.data.node.fields.digest, artifactDigest);
    assert.equal(artifact.data.node.fields.observedBytesDigest, artifactDigest);
    assert.equal(artifact.data.justification.conclusion, artifactId);
    assert.deepEqual(artifact.data.justification.groups[0]?.premises, [claimId]);
    const historicalRevision = artifact.revision;
    assert.equal(historicalRevision, 5);

    const historicalWhyBefore = success<WhyPayload>(await client.callTool({
      name: "why",
      arguments: {
        project_id: first.id,
        kb: "research",
        nodeId: artifactId,
        revision: historicalRevision,
        evaluationTime: FIXED_EVALUATION_TIME
      }
    }));
    assert.equal(historicalWhyBefore.revision, historicalRevision);
    assert.equal(historicalWhyBefore.data.node.id, artifactId);
    assert.equal(historicalWhyBefore.data.node.kind, "artifact");
    assert.equal(historicalWhyBefore.data.evaluationTime, "2026-01-02T00:00:00.000Z");
    assert.equal(historicalWhyBefore.data.support.status, "usable");
    assert.equal(historicalWhyBefore.data.originalBasis?.justification.conclusion, artifactId);
    assert.deepEqual(historicalWhyBefore.data.originalBasis?.justification.groups[0]?.premises, [claimId]);
    assert.equal(historicalWhyBefore.data.originalBasis?.recordedAtRevision, historicalRevision);
    assert.deepEqual(historicalWhyBefore.data.upstream.map(({ id }) => id).sort(), [
      captured.data.source.nodeId,
      captured.data.evidence.id,
      claimId
    ].sort());
    assert.deepEqual(historicalWhyBefore.data.provenance, [{
      sourceId: captured.data.source.id,
      observationId: captured.data.observation.id,
      observedText: initialText,
      providerRevision: `sha256:${initialDigest}`
    }]);
    assert.deepEqual(historicalWhyBefore.data.reviews, []);
    assert.deepEqual(historicalWhyBefore.data.changes, []);

    await writeFile(join(firstRoot, sourceLocator), changedText, "utf8");
    const refreshed = success<{
      revision: number;
      data: {
        changed: boolean;
        committed: boolean;
        sources: Array<{ id: string; currentObservationId?: string; currentDigest?: string }>;
        observations: Array<{
          id: string;
          sourceId: string;
          digest: string;
          observedText: string;
          observedBytesDigest: string;
          providerRevision: string;
        }>;
        changes: Array<{
          id: string;
          sourceId: string;
          beforeObservationId?: string;
          afterObservationId?: string;
          beforeDigest?: string;
          afterDigest?: string;
          reason: string;
        }>;
        reviews: Array<{ id: string; nodeId: string; triggerType: string; triggerId: string; status: string }>;
      };
    }>(await client.callTool({
      name: "refresh",
      arguments: {
        project_id: first.id,
        kb: "research",
        sourceIds: [captured.data.source.id],
        actor: ACTOR,
        at: REFRESH_AT,
        evaluationTime: REFRESH_AT
      }
    }));
    assert.equal(refreshed.revision, historicalRevision + 1);
    assert.equal(refreshed.data.changed, true);
    assert.equal(refreshed.data.committed, true);
    assert.deepEqual(refreshed.data.sources.map(({ id }) => id), [captured.data.source.id]);
    assert.equal(refreshed.data.sources[0]?.currentDigest, changedDigest);
    assert.equal(refreshed.data.observations.length, 1);
    const newObservation = refreshed.data.observations[0];
    assert.ok(newObservation);
    assert.notEqual(newObservation.id, captured.data.observation.id);
    assert.equal(newObservation.sourceId, captured.data.source.id);
    assert.equal(newObservation.digest, changedDigest);
    assert.equal(newObservation.observedText, changedText);
    assert.equal(newObservation.observedBytesDigest, changedDigest);
    assert.equal(newObservation.providerRevision, `sha256:${changedDigest}`);
    assert.equal(refreshed.data.changes.length, 1);
    const change = refreshed.data.changes[0];
    assert.ok(change);
    assert.equal(change.sourceId, captured.data.source.id);
    assert.equal(change.beforeObservationId, captured.data.observation.id);
    assert.equal(change.afterObservationId, newObservation.id);
    assert.equal(change.beforeDigest, initialDigest);
    assert.equal(change.afterDigest, changedDigest);
    assert.equal(change.reason, "content_changed");

    const expectedReviewNodeIds = [captured.data.evidence.id, claimId, artifactId].sort();
    assert.deepEqual(refreshed.data.reviews.map(({ nodeId }) => nodeId).sort(), expectedReviewNodeIds);
    assert.equal(refreshed.data.reviews.length, expectedReviewNodeIds.length);
    assert.equal(refreshed.data.reviews.every((review) => review.triggerType === "change" && review.triggerId === change.id && review.status === "open"), true);

    const impact = success<{
      revision: number;
      data: {
        node: { id: string };
        affected: Array<{ node: { id: string; kind: string }; paths: string[][]; reasons: string[] }>;
        changes: Array<{ id: string }>;
        reviews: Array<{ nodeId: string; triggerId: string; status: string }>;
      };
    }>(await client.callTool({
      name: "impact",
      arguments: {
        project_id: first.id,
        kb: "research",
        nodeId: captured.data.source.nodeId,
        evaluationTime: REFRESH_AT
      }
    }));
    assert.equal(impact.data.node.id, captured.data.source.nodeId);
    const newEvidence = impact.data.affected.find(({ node }) => node.id !== captured.data.evidence.id && node.id !== claimId && node.id !== artifactId);
    assert.ok(newEvidence);
    assert.equal(newEvidence.node.kind, "evidence");
    const expectedAffectedIds = [captured.data.evidence.id, newEvidence.node.id, claimId, artifactId].sort();
    assert.deepEqual(impact.data.affected.map(({ node }) => node.id).sort(), expectedAffectedIds);
    const expectedPaths = new Map<string, string[][]>([
      [captured.data.evidence.id, [[captured.data.source.nodeId, captured.data.evidence.id]]]
    ]);
    expectedPaths.set(newEvidence.node.id, [[captured.data.source.nodeId, newEvidence.node.id]]);
    expectedPaths.set(claimId, [[captured.data.source.nodeId, captured.data.evidence.id, claimId]]);
    expectedPaths.set(artifactId, [[captured.data.source.nodeId, captured.data.evidence.id, claimId, artifactId]]);
    for (const entry of impact.data.affected) {
      assert.deepEqual(entry.paths, expectedPaths.get(entry.node.id));
      assert.equal(entry.reasons.length > 0, true);
    }
    assert.deepEqual(impact.data.changes.map(({ id }) => id), [change.id]);
    assert.deepEqual(impact.data.reviews.map(({ nodeId }) => nodeId).sort(), expectedReviewNodeIds);
    assert.equal(impact.data.reviews.every((review) => review.triggerId === change.id && review.status === "open"), true);

    const reviewsBeforeRestart = success<{
      revision: number;
      data: {
        reviews: Array<{ id: string; nodeId: string; triggerType: string; triggerId: string; status: string }>;
        changes: Array<{ id: string }>;
      };
    }>(await client.callTool({
      name: "review",
      arguments: { project_id: first.id, kb: "research" }
    }));
    assert.equal(reviewsBeforeRestart.revision, refreshed.revision);
    assert.deepEqual(reviewsBeforeRestart.data.reviews.map(({ nodeId }) => nodeId).sort(), expectedReviewNodeIds);
    assert.deepEqual(reviewsBeforeRestart.data.changes.map(({ id }) => id), [change.id]);
    assert.equal(reviewsBeforeRestart.data.reviews.every((review) => review.status === "open" && review.triggerId === change.id), true);

    const currentWhyBeforeRestart = success<WhyPayload>(await client.callTool({
      name: "why",
      arguments: {
        project_id: first.id,
        kb: "research",
        nodeId: artifactId,
        evaluationTime: FIXED_EVALUATION_TIME
      }
    }));
    assert.equal(currentWhyBeforeRestart.revision, refreshed.revision);
    assert.equal(currentWhyBeforeRestart.data.support.status, "pending");
    assert.deepEqual(currentWhyBeforeRestart.data.reviews.map(({ nodeId }) => nodeId).sort(), expectedReviewNodeIds);
    assert.deepEqual(currentWhyBeforeRestart.data.changes.map(({ id }) => id), [change.id]);

    const unchangedRefresh = success<{
      revision: number;
      data: { changed: boolean; committed: boolean; observations: unknown[]; changes: unknown[]; reviews: unknown[] };
    }>(await client.callTool({
      name: "refresh",
      arguments: {
        project_id: first.id,
        kb: "research",
        sourceIds: [captured.data.source.id],
        actor: ACTOR,
        at: REBUILD_AT,
        evaluationTime: REBUILD_AT
      }
    }));
    assert.equal(unchangedRefresh.revision, refreshed.revision);
    assert.equal(unchangedRefresh.data.changed, false);
    assert.equal(unchangedRefresh.data.committed, false);
    assert.deepEqual(unchangedRefresh.data.observations, []);
    assert.deepEqual(unchangedRefresh.data.changes, []);
    assert.deepEqual(unchangedRefresh.data.reviews, []);
    const reviewsAfterUnchanged = success(await client.callTool({
      name: "review",
      arguments: { project_id: first.id, kb: "research" }
    }));
    assert.deepEqual(reviewsAfterUnchanged, reviewsBeforeRestart);

    const secondBeforeForeignRoute = success<{
      revision: number;
      data: { project: { id: string }; knowledgeBases: Array<{ id: string }> };
    }>(await client.callTool({
      name: "knowledge_bases",
      arguments: { project_id: second.id }
    }));
    const foreignRoute = await client.callTool({
      name: "why",
      arguments: {
        project_id: second.id,
        kb: "shared",
        nodeId: artifactId,
        evaluationTime: FIXED_EVALUATION_TIME
      }
    });
    assert.equal(foreignRoute.isError, true);
    assert.deepEqual(foreignRoute.structuredContent, {
      error: {
        code: "NOT_FOUND",
        message: `node not found: ${artifactId}`,
        retryable: false,
        details: { id: artifactId }
      }
    });
    const secondAfterForeignRoute = success(await client.callTool({
      name: "knowledge_bases",
      arguments: { project_id: second.id }
    }));
    assert.deepEqual(secondAfterForeignRoute, secondBeforeForeignRoute);

    await client.close();
    client = undefined;
    for (const root of [firstRoot, secondRoot]) {
      const disposablePath = join(root, ".justification");
      await rm(disposablePath, { recursive: true, force: true });
      await assertMissing(disposablePath);
    }

    restartedClient = new Client(
      { name: "justification-mcp-maintenance-restarted", version: "0.0.1" },
      { versionNegotiation: { mode: "auto" } }
    );
    await restartedClient.connect(transport(cli, firstRoot, secondRoot));
    assert.equal(restartedClient.getProtocolEra(), "modern");
    assert.equal(restartedClient.getNegotiatedProtocolVersion(), "2026-07-28");

    const rebuiltFirst = success<{
      revision: number;
      data: { rebuilt: true; committed: false; revision: number; index: { path: string; digest: string }; projection: { files: string[]; manifestDigest: string } };
    }>(await restartedClient.callTool({
      name: "rebuild",
      arguments: { project_id: first.id, actor: ACTOR, at: REBUILD_AT }
    }));
    assert.equal(rebuiltFirst.revision, refreshed.revision);
    assert.equal(rebuiltFirst.data.rebuilt, true);
    assert.equal(rebuiltFirst.data.committed, false);
    assert.equal(rebuiltFirst.data.revision, refreshed.revision);
    assert.equal(rebuiltFirst.data.index.path, ".justification/index.json");
    assert.match(rebuiltFirst.data.index.digest, /^[0-9a-f]{64}$/);
    assert.equal(rebuiltFirst.data.projection.files.includes("kb/research/index.md"), true);

    const rebuiltSecond = success<{
      revision: number;
      data: { rebuilt: true; committed: false; revision: number; index: { path: string; digest: string } };
    }>(await restartedClient.callTool({
      name: "rebuild",
      arguments: { project_id: second.id, actor: ACTOR, at: REBUILD_AT }
    }));
    assert.equal(rebuiltSecond.revision, secondBeforeForeignRoute.revision);
    assert.equal(rebuiltSecond.data.rebuilt, true);
    assert.equal(rebuiltSecond.data.committed, false);
    assert.equal(rebuiltSecond.data.revision, secondBeforeForeignRoute.revision);
    assert.equal(rebuiltSecond.data.index.path, ".justification/index.json");
    assert.match(rebuiltSecond.data.index.digest, /^[0-9a-f]{64}$/);

    const currentWhyAfterRebuild = success<WhyPayload>(await restartedClient.callTool({
      name: "why",
      arguments: {
        project_id: first.id,
        kb: "research",
        nodeId: artifactId,
        evaluationTime: FIXED_EVALUATION_TIME
      }
    }));
    assert.deepEqual(currentWhyAfterRebuild, currentWhyBeforeRestart);

    const historicalWhyAfterRebuild = success<WhyPayload>(await restartedClient.callTool({
      name: "why",
      arguments: {
        project_id: first.id,
        kb: "research",
        nodeId: artifactId,
        revision: historicalRevision,
        evaluationTime: FIXED_EVALUATION_TIME
      }
    }));
    assert.deepEqual(historicalWhyAfterRebuild, historicalWhyBefore);

    const reviewsAfterRebuild = success(await restartedClient.callTool({
      name: "review",
      arguments: { project_id: first.id, kb: "research" }
    }));
    assert.deepEqual(reviewsAfterRebuild, reviewsBeforeRestart);
  } finally {
    if (client !== undefined) await client.close().catch(() => undefined);
    if (restartedClient !== undefined) await restartedClient.close().catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});
