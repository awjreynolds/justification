import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { initializeProject } from "../src/index.ts";

const CREATED_AT = "2026-01-01T00:00:00Z";
const EVALUATION_TIME = "2026-01-02T00:00:00Z";
const ACTOR = "mcp:lifecycle";

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

test("legacy SDK client preserves a scoped ADR chain across restart", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-mcp-lifecycle-"));
  const firstRoot = join(parent, "first");
  const secondRoot = join(parent, "second");
  const cli = join(process.cwd(), "dist", "cli.js");
  let client: Client | undefined;
  let restartedClient: Client | undefined;

  const sourceId = "11111111-1111-4111-8111-111111111111";
  const claimId = "22222222-2222-4222-8222-222222222222";
  const localOptionId = "33333333-3333-4333-8333-333333333333";
  const hostedOptionId = "44444444-4444-4444-8444-444444444444";
  const decisionId = "55555555-5555-4555-8555-555555555555";
  const artifactId = "66666666-6666-4666-8666-666666666666";
  const sourceLocator = "constraints.md";
  const sourceText = "Constraint C1: audit logs must be retained for 90 days.\n";
  const artifactLocator = "adr.md";
  const artifactText = "# ADR: local retention\n\nDecision: retain audit logs locally for 90 days.\n";
  const sourceDigest = createHash("sha256").update(sourceText, "utf8").digest("hex");
  const artifactDigest = createHash("sha256").update(artifactText, "utf8").digest("hex");

  try {
    const first = await initializeProject(firstRoot);
    const second = await initializeProject(secondRoot);
    await writeFile(join(firstRoot, sourceLocator), sourceText, "utf8");
    await writeFile(join(firstRoot, artifactLocator), artifactText, "utf8");

    client = new Client(
      { name: "justification-mcp-lifecycle", version: "0.0.1" },
      { versionNegotiation: { mode: "legacy" } }
    );
    await client.connect(transport(cli, firstRoot, secondRoot));
    assert.equal(client.getProtocolEra(), "legacy");
    assert.equal(client.getNegotiatedProtocolVersion(), "2025-11-25");

    const listed = success<{ projects: Array<{ id: string; root: string }> }>(
      await client.callTool({ name: "projects", arguments: {} })
    );
    assert.deepEqual(listed.projects.map(({ id, root }) => ({ id, root })), [
      { id: first.id, root: first.root },
      { id: second.id, root: second.root }
    ]);

    const createdKb = success<{
      revision: number;
      data: { knowledgeBase: { id: string; parent: string | null } };
    }>(await client.callTool({
      name: "create_kb",
      arguments: {
        project_id: first.id,
        id: "adr",
        title: "Audit log retention ADR",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(createdKb.data.knowledgeBase.id, "adr");
    assert.equal(createdKb.data.knowledgeBase.parent, "shared");

    const captured = success<{
      revision: number;
      data: {
        source: { id: string; nodeId: string; locator: string };
        observation: {
          id: string;
          sourceId: string;
          observedText: string;
          digest: string;
          observedBytesDigest: string;
          providerRevision: string;
        };
        evidence: { id: string; sourceId: string; observationId: string };
      };
    }>(await client.callTool({
      name: "capture_source",
      arguments: {
        project_id: first.id,
        locator: sourceLocator,
        sourceId,
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(captured.data.source.id, sourceId);
    assert.equal(captured.data.source.locator, sourceLocator);
    assert.equal(captured.data.observation.sourceId, sourceId);
    assert.equal(captured.data.observation.observedText, sourceText);
    assert.equal(captured.data.observation.digest, sourceDigest);
    assert.equal(captured.data.observation.observedBytesDigest, sourceDigest);
    assert.equal(captured.data.observation.providerRevision, `sha256:${sourceDigest}`);
    assert.equal(captured.data.evidence.sourceId, sourceId);
    assert.equal(captured.data.evidence.observationId, captured.data.observation.id);

    const claim = success<{
      revision: number;
      data: { node: { id: string; kind: string; kb: string } };
    }>(await client.callTool({
      name: "record",
      arguments: {
        project_id: first.id,
        id: claimId,
        kb: "adr",
        kind: "claim",
        title: "Audit logs must be retained for 90 days",
        body: "The service must retain audit logs for the required period.",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.deepEqual(
      { id: claim.data.node.id, kind: claim.data.node.kind, kb: claim.data.node.kb },
      { id: claimId, kind: "claim", kb: "adr" }
    );

    const justified = success<{
      revision: number;
      data: { justification: { id: string; conclusion: string; groups: Array<{ premises: string[] }> } };
    }>(await client.callTool({
      name: "justify",
      arguments: {
        project_id: first.id,
        kb: "adr",
        conclusion: claimId,
        groups: [[captured.data.evidence.id]],
        rationale: "The retained source observation states the required retention period.",
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(justified.data.justification.conclusion, claimId);
    assert.deepEqual(justified.data.justification.groups[0]?.premises, [captured.data.evidence.id]);

    for (const [id, title, body] of [
      [localOptionId, "Retain locally", "Retain audit logs in the local service storage."],
      [hostedOptionId, "Use hosted storage", "Store audit logs in a hosted storage service."]
    ] as const) {
      const option: { data: { node: { id: string; kind: string } } } = success(await client.callTool({
        name: "record",
        arguments: {
          project_id: first.id,
          id,
          kb: "adr",
          kind: "option",
          title,
          body,
          actor: ACTOR,
          at: CREATED_AT
        }
      }));
      assert.deepEqual(
        { id: option.data.node.id, kind: option.data.node.kind },
        { id, kind: "option" }
      );
    }

    const decision = success<{
      revision: number;
      data: {
        node: {
          id: string;
          kind: string;
          fields: {
            basis: string[];
            consideredOptions: string[];
            selectedOption: string;
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
        id: decisionId,
        kb: "adr",
        kind: "decision",
        title: "Retain audit logs locally",
        body: "Choose local retention to satisfy the audit log requirement.",
        basis: [claimId],
        fields: {
          consideredOptions: [localOptionId, hostedOptionId],
          selectedOption: localOptionId,
          rationale: "Local retention satisfies the retained requirement without a hosted dependency."
        },
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(decision.data.node.id, decisionId);
    assert.equal(decision.data.node.kind, "decision");
    assert.deepEqual(decision.data.node.fields.basis, [claimId]);
    assert.deepEqual(decision.data.node.fields.consideredOptions, [localOptionId, hostedOptionId]);
    assert.equal(decision.data.node.fields.selectedOption, localOptionId);
    assert.match(decision.data.node.fields.originalBasisJustificationId, /^[0-9a-f-]{36}$/);
    assert.equal(decision.data.node.fields.recordedAtRevision, decision.revision);
    assert.equal(decision.data.justification.conclusion, decisionId);
    assert.deepEqual(decision.data.justification.groups[0]?.premises, [claimId]);

    const artifact = success<{
      revision: number;
      data: {
        node: {
          id: string;
          kind: string;
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
        id: artifactId,
        kb: "adr",
        kind: "artifact",
        title: "Audit log retention ADR",
        body: artifactText,
        basis: [decisionId],
        fields: { locator: artifactLocator },
        actor: ACTOR,
        at: CREATED_AT
      }
    }));
    assert.equal(artifact.data.node.id, artifactId);
    assert.equal(artifact.data.node.kind, "artifact");
    assert.deepEqual(artifact.data.node.fields.basis, [decisionId]);
    assert.equal(artifact.data.node.fields.locator, artifactLocator);
    assert.equal(artifact.data.node.fields.digest, artifactDigest);
    assert.equal(artifact.data.node.fields.observedBytesDigest, artifactDigest);
    assert.match(artifact.data.node.fields.originalBasisJustificationId, /^[0-9a-f-]{36}$/);
    assert.equal(artifact.data.node.fields.recordedAtRevision, artifact.revision);
    assert.equal(artifact.data.justification.conclusion, artifactId);
    assert.deepEqual(artifact.data.justification.groups[0]?.premises, [decisionId]);

    const whyBeforeRestart = success<{
      revision: number;
      data: {
        node: { id: string; kind: string };
        evaluationTime: string;
        support: { status: string };
        originalBasis: {
          justification: { conclusion: string; groups: Array<{ premises: string[] }> };
          recordedAtRevision: number;
        } | null;
        upstream: Array<{ id: string }>;
        provenance: Array<{ sourceId: string; observationId: string; observedText: string; providerRevision: string }>;
      };
    }>(await client.callTool({
      name: "why",
      arguments: {
        project_id: first.id,
        kb: "adr",
        nodeId: artifactId,
        revision: artifact.revision,
        evaluationTime: EVALUATION_TIME
      }
    }));
    assert.equal(whyBeforeRestart.data.node.id, artifactId);
    assert.equal(whyBeforeRestart.data.node.kind, "artifact");
    assert.equal(whyBeforeRestart.data.evaluationTime, "2026-01-02T00:00:00.000Z");
    assert.equal(whyBeforeRestart.data.support.status, "usable");
    assert.equal(whyBeforeRestart.data.originalBasis?.justification.conclusion, artifactId);
    assert.equal(whyBeforeRestart.data.originalBasis?.recordedAtRevision, artifact.revision);
    assert.deepEqual(whyBeforeRestart.data.originalBasis?.justification.groups[0]?.premises, [decisionId]);
    const upstreamIds = new Set(whyBeforeRestart.data.upstream.map(({ id }) => id));
    for (const expectedId of [decisionId, claimId, captured.data.evidence.id, captured.data.source.nodeId]) {
      assert.equal(upstreamIds.has(expectedId), true, `missing ancestry ${expectedId}`);
    }
    assert.deepEqual([...upstreamIds].sort(), [
      decisionId,
      claimId,
      captured.data.evidence.id,
      captured.data.source.nodeId
    ].sort());
    assert.deepEqual(whyBeforeRestart.data.provenance, [{
      sourceId,
      observationId: captured.data.observation.id,
      observedText: sourceText,
      providerRevision: `sha256:${sourceDigest}`
    }]);

    await client.close();
    client = undefined;

    restartedClient = new Client(
      { name: "justification-mcp-lifecycle-restarted", version: "0.0.1" },
      { versionNegotiation: { mode: "legacy" } }
    );
    await restartedClient.connect(transport(cli, firstRoot, secondRoot));
    assert.equal(restartedClient.getProtocolEra(), "legacy");
    assert.equal(restartedClient.getNegotiatedProtocolVersion(), "2025-11-25");

    const whyAfterRestart = success(await restartedClient.callTool({
      name: "why",
      arguments: {
        project_id: first.id,
        kb: "adr",
        nodeId: artifactId,
        revision: artifact.revision,
        evaluationTime: EVALUATION_TIME
      }
    }));
    assert.deepEqual(whyAfterRestart, whyBeforeRestart);
  } finally {
    await client?.close().catch(() => undefined);
    await restartedClient?.close().catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});
