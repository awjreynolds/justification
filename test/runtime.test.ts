import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseDocument } from "yaml";

import { executeOperation, initializeProject } from "../src/index.ts";

test("knowledge_bases discovers the shared KB after project initialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-bootstrap-"));
  try {
    await initializeProject(root);
    const response = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(response.data instanceof Object, true);
    const data = response.data as { knowledgeBases: Array<{ id: string; parent: string | null }> };
    assert.deepEqual(data.knowledgeBases.map((kb) => ({ id: kb.id, parent: kb.parent })), [{ id: "shared", parent: null }]);
    assert.equal(response.revision, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("create_kb creates a persistent child inheriting shared knowledge", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-kb-"));
  try {
    await initializeProject(root);
    const created = await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:test"
    });
    assert.equal(created.revision, 1);
    const createdData = created.data as { knowledgeBase: { id: string; parent: string | null; title: string } };
    assert.equal(createdData.knowledgeBase.id, "adr");
    assert.equal(createdData.knowledgeBase.parent, "shared");
    assert.equal(createdData.knowledgeBase.title, "Architecture decision");

    const listed = await executeOperation(root, { op: "knowledge_bases" });
    const listedData = listed.data as { knowledgeBases: Array<{ id: string; parent: string | null }> };
    assert.deepEqual(listedData.knowledgeBases.map((kb) => ({ id: kb.id, parent: kb.parent })), [
      { id: "adr", parent: "shared" },
      { id: "shared", parent: null }
    ]);
    assert.equal(listed.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects a history directory symlink without writing outside the project", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-runtime-history-link-"));
  const root = join(parent, "project");
  const outside = join(parent, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  try {
    await initializeProject(root);
    await symlink(outside, join(root, "justification-history"));

    await assert.rejects(
      executeOperation(root, { op: "knowledge_bases" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "HISTORY_CORRUPT");
        return true;
      }
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("export writes a readable current OKF projection and preserves unrelated KB files", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-export-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "knowledge_bases" });
    await rewriteInitialRevision(root, (state) => {
      const nodes = state.nodes as Record<string, unknown>;
      nodes.claim1 = {
        id: "claim1",
        kb: "shared",
        kind: "claim",
        title: "Retained claim",
        body: "A retained claim.",
        createdBy: "human:test",
        createdAt: "2026-01-01T00:00:00.000Z"
      };
    });
    const keepPath = join(root, "kb", "shared", "keep.txt");
    await writeFile(keepPath, "unrelated project knowledge\n", "utf8");

    const exported = await executeOperation(root, { op: "export" });
    const data = exported.data as { historyIncluded: boolean; files: string[]; directory: string };
    assert.equal(data.historyIncluded, false);
    assert.ok(data.files.includes("kb/index.md"));
    assert.equal(await readFile(keepPath, "utf8"), "unrelated project knowledge\n");

    const index = await readFile(join(root, "kb", "index.md"), "utf8");
    assert.equal(index.startsWith("---\n"), true);
    const closing = index.indexOf("\n---\n", 4);
    assert.ok(closing > 4);
    const frontmatter = parseDocument(index.slice(4, closing)).toJSON() as { okf_version?: string };
    assert.equal(frontmatter.okf_version, "0.2");
    assert.equal(index.slice(closing, closing + 5), "\n---\n");

    const sharedIndex = await readFile(join(root, "kb", "shared", "index.md"), "utf8");
    assert.equal(sharedIndex.startsWith("---\n"), false);
    assert.equal(sharedIndex.startsWith("# Shared knowledge\n"), true);

    const claim = await readFile(join(root, "kb", "shared", "claim1.md"), "utf8");
    assert.equal(claim.startsWith("---\n"), true);
    const claimClosing = claim.indexOf("\n---\n", 4);
    assert.ok(claimClosing > 4);
    const claimFrontmatter = parseDocument(claim.slice(4, claimClosing)).toJSON() as { type?: string; justification?: { id?: string } };
    assert.equal(claimFrontmatter.type, "claim");
    assert.equal(claimFrontmatter.justification?.id, "claim1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export refuses a human-owned generated destination before any publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-export-collision-"));
  try {
    await initializeProject(root);
    const humanPath = join(root, "kb", "shared", "index.md");
    const humanBytes = "# Human-owned knowledge base index\nKeep this exact file.\n";
    await writeFile(humanPath, humanBytes, "utf8");

    await assert.rejects(
      executeOperation(root, { op: "export" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "PROJECTION_DRIFT");
        return true;
      }
    );
    assert.equal(await readFile(humanPath, "utf8"), humanBytes);
    await assert.rejects(readFile(join(root, "kb", "index.md")), (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    });
    await assert.rejects(readFile(join(root, ".justification", "projection-manifest.json")), (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects integrity-valid history with dangling domain references", async () => {
  const cases: Array<[string, (state: Record<string, unknown>) => void]> = [
    ["knowledge base parent", (state) => {
      const kbs = state.kbs as Record<string, unknown>;
      kbs.child = { id: "child", title: "Child", parent: "missing", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }],
    ["source node", (state) => {
      addFixtureNode(state, "valid-source-node", "source");
      const sources = state.sources as Record<string, unknown>;
      sources.source1 = { id: "source1", nodeId: "missing", kb: "shared", providerId: "file", locator: "note.md", availability: "missing", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }],
    ["observation source", (state) => {
      addFixtureNode(state, "valid-source-node", "source");
      const sources = state.sources as Record<string, unknown>;
      sources.source1 = { id: "source1", nodeId: "valid-source-node", kb: "shared", providerId: "file", locator: "note.md", availability: "missing", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
      const observations = state.observations as Record<string, unknown>;
      observations.observation1 = { id: "observation1", sourceId: "missing", providerId: "file", locator: "note.md", availability: "missing", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }],
    ["justification premises", (state) => {
      addFixtureNode(state, "valid-claim", "claim");
      const justifications = state.justifications as Record<string, unknown>;
      justifications.justification1 = { id: "justification1", kb: "shared", conclusion: "valid-claim", groups: [{ id: "group1", premises: ["missing-premise"] }], rationale: "fixture", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }],
    ["relationship endpoints", (state) => {
      addFixtureNode(state, "valid-node", "claim");
      const relationships = state.relationships as Record<string, unknown>;
      relationships.relationship1 = { id: "relationship1", kb: "shared", from: "valid-node", to: "missing", type: "depends_on", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }]
  ];

  for (const [label, mutate] of cases) {
    const root = await mkdtemp(join(tmpdir(), "justification-runtime-domain-state-"));
    try {
      await initializeProject(root);
      await executeOperation(root, { op: "knowledge_bases" });
      await rewriteInitialRevision(root, mutate);
      await assert.rejects(
        executeOperation(root, { op: "knowledge_bases" }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "HISTORY_CORRUPT", label);
          return true;
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

function addFixtureNode(state: Record<string, unknown>, id: string, kind: string): void {
  const nodes = state.nodes as Record<string, unknown>;
  nodes[id] = { id, kb: "shared", kind, title: id, body: "fixture", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
}

test("create_kb rejects nested knowledge bases beyond the shared parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-kb-parent-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "child", title: "Child", actor: "human:test" });
    await assert.rejects(
      executeOperation(root, { op: "create_kb", id: "grandchild", title: "Grandchild", parent: "child", actor: "human:test" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "INVALID_SCOPE");
        return true;
      }
    );
    const listed = await executeOperation(root, { op: "knowledge_bases" });
    const data = listed.data as { knowledgeBases: Array<{ id: string }> };
    assert.deepEqual(data.knowledgeBases.map((kb) => kb.id), ["child", "shared"]);
    assert.equal(listed.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scoped KB lookup rejects inherited object keys and never widens visibility", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-kb-scope-"));
  try {
    await initializeProject(root);
    await assert.rejects(
      executeOperation(root, { op: "knowledge_bases", kb: "toString" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "NOT_FOUND");
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("create_kb rejects a stale expected revision without changing durable state", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-expected-revision-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "first", title: "First", actor: "human:test" });
    await assert.rejects(
      executeOperation(root, { op: "create_kb", id: "second", title: "Second", actor: "human:test", expectedRevision: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "CONFLICT");
        return true;
      }
    );
    const listed = await executeOperation(root, { op: "knowledge_bases" });
    const data = listed.data as { knowledgeBases: Array<{ id: string }> };
    assert.deepEqual(data.knowledgeBases.map((kb) => kb.id), ["first", "shared"]);
    assert.equal(listed.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function rewriteInitialRevision(root: string, mutate: (state: Record<string, unknown>) => void): Promise<void> {
  const path = join(root, "justification-history", "000000000000.json");
  const revision = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const state = revision.state as Record<string, unknown>;
  mutate(state);
  const unsigned = { ...revision };
  delete unsigned.integrity;
  revision.integrity = createHash("sha256").update(canonicalJsonForTest(unsigned)).digest("hex");
  await writeFile(path, `${JSON.stringify(revision, null, 2)}\n`, "utf8");
}

function canonicalJsonForTest(value: unknown): string {
  const canonical = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonical);
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
    }
    return candidate;
  };
  return JSON.stringify(canonical(value));
}

test("records and explains a complete ADR evidence chain with original basis and readable export", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-adr-chain-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "adr", title: "Architecture decision", actor: "human:author" });

    const sourceLocator = "constraints.md";
    const sourceText = "Run 2026-09-10 with network access blocked: PASS\nConstraint C1: the service must run without network access.\n";
    const expectedBytesDigest = createHash("sha256").update(sourceText, "utf8").digest("hex");
    await writeFile(join(root, sourceLocator), sourceText, "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      kb: "shared",
      locator: sourceLocator,
      actor: "process:capture"
    });
    const capturedData = captured.data as {
      source: { id: string; nodeId: string; locator: string };
      observation: { id: string; observedText: string; observedBytesDigest: string; providerRevision: string; digest: string };
      evidence: { id: string; sourceId: string; observationId: string };
    };
    assert.equal(capturedData.source.locator, sourceLocator);
    assert.equal(capturedData.observation.observedText, sourceText);
    assert.equal(capturedData.observation.observedBytesDigest, expectedBytesDigest);
    assert.equal(capturedData.observation.providerRevision, `sha256:${expectedBytesDigest}`);
    assert.equal(capturedData.observation.digest, expectedBytesDigest);
    assert.equal(capturedData.evidence.sourceId, capturedData.source.id);
    assert.equal(capturedData.evidence.observationId, capturedData.observation.id);

    const constraint = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "requirement",
      title: "Offline operation is required",
      body: "The service must run without network access.",
      fields: { accepted: true, propositionKey: "offline-operation" },
      actor: "human:author"
    });
    const constraintId = (constraint.data as { node: { id: string } }).node.id;

    const claim = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "claim",
      title: "The selected design satisfies the offline constraint",
      body: "The selected design can run without network access.",
      actor: "human:author"
    });
    const claimId = (claim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "adr",
      conclusion: claimId,
      groups: [[capturedData.evidence.id, constraintId]],
      rationale: "The retained source observation states the constraint and the requirement is accepted for this ADR.",
      actor: "human:author"
    });

    const optionIds: string[] = [];
    for (const [title, body] of [
      ["Run locally", "Run the service entirely on the local host."],
      ["Use a hosted service", "Use a hosted dependency for execution."],
      ["Defer the decision", "Defer the architecture decision." ]
    ] as const) {
      const option = await executeOperation(root, {
        op: "record",
        kb: "adr",
        kind: "option",
        title,
        body,
        actor: "human:author"
      });
      optionIds.push((option.data as { node: { id: string } }).node.id);
    }

    const decision = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "decision",
      title: "Choose local execution",
      body: "We choose local execution for this ADR.",
      basis: [claimId],
      fields: {
        consideredOptions: optionIds,
        selectedOption: optionIds[0],
        rationale: "Local execution satisfies the retained offline constraint."
      },
      actor: "human:author"
    });
    const decisionData = decision.data as { node: { id: string; fields?: { recordedAtRevision?: number; originalBasisJustificationId?: string } }; justification?: { id: string } };
    const decisionId = decisionData.node.id;
    assert.equal(decisionData.node.fields?.recordedAtRevision, decision.revision);
    assert.match(decisionData.node.fields?.originalBasisJustificationId ?? "", /.+/);

    const artifactLocator = "adr.md";
    const artifactText = "# ADR: local execution\n\nDecision: choose local execution.\n";
    await writeFile(join(root, artifactLocator), artifactText, "utf8");
    const artifact = await executeOperation(root, {
      op: "record",
      kb: "adr",
      kind: "artifact",
      title: "Architecture decision record",
      body: artifactText,
      basis: [decisionId],
      fields: { locator: artifactLocator },
      actor: "human:author"
    });
    const artifactData = artifact.data as { node: { id: string; fields?: { recordedAtRevision?: number; originalBasisJustificationId?: string } }; justification?: { id: string } };
    assert.equal(artifactData.node.fields?.recordedAtRevision, artifact.revision);
    assert.match(artifactData.node.fields?.originalBasisJustificationId ?? "", /.+/);

    const explained = await executeOperation(root, { op: "why", nodeId: artifactData.node.id, kb: "adr", evaluationTime: "2026-09-10T00:00:00Z" });
    const explanation = explained.data as {
      node: { id: string };
      originalBasis: { justification: { conclusion: string; groups: Array<{ premises: string[] }> } };
      upstream: Array<{ id: string }>;
      provenance: Array<{ sourceId: string; observationId: string; observedText: string; providerRevision: string }>;
    };
    const upstreamIds = new Set(explanation.upstream.map((node) => node.id));
    assert.equal(explanation.node.id, artifactData.node.id);
    assert.equal(explanation.originalBasis.justification.conclusion, artifactData.node.id);
    assert.deepEqual(explanation.originalBasis.justification.groups[0]?.premises, [decisionId]);
    for (const expectedId of [decisionId, claimId, constraintId, capturedData.evidence.id, capturedData.source.nodeId]) assert.equal(upstreamIds.has(expectedId), true, `missing ancestry ${expectedId}`);
    assert.deepEqual(explanation.provenance, [{
      sourceId: capturedData.source.id,
      observationId: capturedData.observation.id,
      observedText: sourceText,
      providerRevision: capturedData.observation.providerRevision
    }]);

    const exported = await executeOperation(root, { op: "export", kb: "adr" });
    const exportData = exported.data as { files: string[]; historyIncluded: boolean };
    const artifactPath = `kb/adr/${artifactData.node.id}.md`;
    assert.equal(exportData.historyIncluded, false);
    assert.equal(exportData.files.includes(artifactPath), true);
    const artifactDocument = await readFile(join(root, artifactPath), "utf8");
    const closing = artifactDocument.indexOf("\n---\n", 4);
    assert.ok(closing > 4);
    const frontmatter = parseDocument(artifactDocument.slice(4, closing)).toJSON() as { type?: string; justification?: { id?: string; fields?: { basis?: string[] } } };
    assert.equal(frontmatter.type, "artifact");
    assert.equal(frontmatter.justification?.id, artifactData.node.id);
    assert.deepEqual(frontmatter.justification?.fields?.basis, [decisionId]);
    for (const expectedText of [decisionId, claimId, constraintId, capturedData.evidence.id, capturedData.source.id, sourceLocator, "Local execution satisfies the retained offline constraint."]) assert.equal(artifactDocument.includes(expectedText), true, `missing exported provenance ${expectedText}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a justification that would close a support cycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-cycle-"));
  try {
    await initializeProject(root);
    const first = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "First claim",
      body: "The first claim is supported by the second claim.",
      actor: "human:test"
    });
    const firstId = (first.data as { node: { id: string } }).node.id;
    const second = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Second claim",
      body: "The second claim is supported by the first claim.",
      actor: "human:test"
    });
    const secondId = (second.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      conclusion: firstId,
      groups: [[secondId]],
      rationale: "The second claim supports the first claim.",
      actor: "human:test"
    });
    const beforeRejectedAttempt = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "justify",
        conclusion: secondId,
        groups: [[firstId]],
        rationale: "The first claim supports the second claim.",
        actor: "human:test"
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SUPPORT_CYCLE");
        return true;
      }
    );
    const afterRejectedAttempt = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(afterRejectedAttempt.revision, beforeRejectedAttempt.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
