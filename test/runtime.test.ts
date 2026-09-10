import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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

test("reports a committed revision when projection publication fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-projection-failure-"));
  const derivedPath = join(root, ".justification");
  try {
    await initializeProject(root);
    await mkdir(derivedPath, { recursive: true });
    await chmod(derivedPath, 0o500);
    try {
      await assert.rejects(
        executeOperation(root, {
          op: "record",
          kb: "shared",
          kind: "claim",
          title: "Projection failure claim",
          body: "The semantic transaction should remain durable.",
          actor: "human:test"
        }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "PROJECTION_FAILED");
          const details = (error as { details?: { revision?: number; committed?: boolean } }).details;
          assert.equal(details?.revision, 1);
          assert.equal(details?.committed, true);
          return true;
        }
      );
    } finally {
      await chmod(derivedPath, 0o700);
    }
    const durable = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(durable.revision, 1);
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

test("rejects child-scoped support that would make a shared conclusion leak", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-shared-conclusion-scope-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "child-a", title: "Child A", actor: "human:test" });
    await executeOperation(root, { op: "create_kb", id: "child-b", title: "Child B", actor: "human:test" });
    const conclusion = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared conclusion",
      body: "This conclusion is visible to every child.",
      actor: "human:test"
    });
    const conclusionId = (conclusion.data as { node: { id: string } }).node.id;
    const childPremise = await executeOperation(root, {
      op: "record",
      kb: "child-a",
      kind: "requirement",
      title: "Child A only premise",
      body: "Only child A should be able to use this premise.",
      fields: { accepted: true },
      actor: "human:test"
    });
    const childPremiseId = (childPremise.data as { node: { id: string } }).node.id;

    await assert.rejects(
      executeOperation(root, {
        op: "justify",
        kb: "child-a",
        conclusion: conclusionId,
        groups: [[childPremiseId]],
        rationale: "Child A's premise supports the shared conclusion.",
        actor: "human:test"
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SCOPE_VIOLATION");
        return true;
      }
    );

    const siblingView = await executeOperation(root, { op: "why", nodeId: conclusionId, kb: "child-b" });
    const siblingData = siblingView.data as { upstream: Array<{ id: string }> };
    assert.equal(siblingData.upstream.some((node) => node.id === childPremiseId), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects child-owned support for a shared conclusion even with shared premises", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-shared-owned-support-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "child-a", title: "Child A", actor: "human:test" });
    await executeOperation(root, { op: "create_kb", id: "child-b", title: "Child B", actor: "human:test" });
    const premise = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "requirement",
      title: "Shared premise",
      body: "Every child can use this accepted premise.",
      fields: { accepted: true },
      actor: "human:test"
    });
    const premiseId = (premise.data as { node: { id: string } }).node.id;
    const conclusion = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Shared conclusion",
      body: "This conclusion must have shared ownership.",
      actor: "human:test"
    });
    const conclusionId = (conclusion.data as { node: { id: string } }).node.id;
    const beforeRejected = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "justify",
        kb: "child-a",
        conclusion: conclusionId,
        groups: [[premiseId]],
        rationale: "Child A's rationale must not support a shared conclusion.",
        actor: "human:test"
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SCOPE_VIOLATION");
        return true;
      }
    );

    const afterRejected = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(afterRejected.revision, beforeRejected.revision);
    const siblingView = await executeOperation(root, { op: "why", nodeId: conclusionId, kb: "child-b" });
    const siblingData = siblingView.data as {
      support: { status: string };
      currentSupport: Array<{ justification: { rationale: string } }>;
    };
    assert.equal(siblingData.support.status, "pending");
    assert.deepEqual(siblingData.currentSupport, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps child-owned relationships out of a sibling shared export", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-shared-export-scope-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "child-a", title: "Child A", actor: "human:test" });
    await executeOperation(root, { op: "create_kb", id: "child-b", title: "Child B", actor: "human:test" });
    const sharedTarget = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "requirement",
      title: "Shared target",
      body: "The target is visible to both children.",
      actor: "human:test"
    });
    const sharedTargetId = (sharedTarget.data as { node: { id: string } }).node.id;
    const childClaim = await executeOperation(root, {
      op: "record",
      kb: "child-a",
      kind: "claim",
      title: "Child A claim",
      body: "This claim is visible only to child A.",
      links: [{ to: sharedTargetId, type: "references", rationale: "Child A private relationship rationale." }],
      actor: "human:test"
    });
    const childClaimData = childClaim.data as { node: { id: string } };

    await executeOperation(root, { op: "export", kb: "child-a" });
    const ownerDocument = await readFile(join(root, "kb", "child-a", `${childClaimData.node.id}.md`), "utf8");
    const ownerClosing = ownerDocument.indexOf("\n---\n", 4);
    const ownerFrontmatter = parseDocument(ownerDocument.slice(4, ownerClosing)).toJSON() as {
      justification?: { relationships?: Array<Record<string, unknown>> };
    };
    assert.equal(ownerFrontmatter.justification?.relationships?.length, 1);
    assert.equal(ownerFrontmatter.justification?.relationships?.[0]?.from, childClaimData.node.id);
    assert.equal(ownerFrontmatter.justification?.relationships?.[0]?.to, sharedTargetId);

    await executeOperation(root, { op: "export", kb: "child-b" });
    const siblingDocument = await readFile(join(root, "kb", "shared", `${sharedTargetId}.md`), "utf8");
    const siblingClosing = siblingDocument.indexOf("\n---\n", 4);
    const siblingFrontmatter = parseDocument(siblingDocument.slice(4, siblingClosing)).toJSON() as {
      justification?: { relationships?: Array<Record<string, unknown>> };
    };
    assert.equal(siblingDocument.includes(childClaimData.node.id), false);
    assert.equal(siblingDocument.includes("Child A private relationship rationale."), false);
    assert.deepEqual(siblingFrontmatter.justification?.relationships ?? [], []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scoped export preserves untouched generated ownership for later mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-scoped-export-ownership-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "child-a", title: "Child A", actor: "human:test" });
    await executeOperation(root, { op: "create_kb", id: "child-b", title: "Child B", actor: "human:test" });
    await executeOperation(root, {
      op: "record",
      kb: "child-a",
      kind: "claim",
      title: "First child claim",
      body: "The first child claim is already projected.",
      actor: "human:test"
    });

    await executeOperation(root, { op: "export", kb: "child-b" });
    const beforeMutation = await executeOperation(root, { op: "knowledge_bases" });
    const secondClaim = await executeOperation(root, {
      op: "record",
      kb: "child-a",
      kind: "claim",
      title: "Second child claim",
      body: "A later mutation must republish every generated document safely.",
      actor: "human:test"
    });
    assert.equal(secondClaim.revision, beforeMutation.revision + 1);
    const secondClaimId = (secondClaim.data as { node: { id: string } }).node.id;
    assert.equal((await readFile(join(root, "kb", "child-a", `${secondClaimId}.md`), "utf8")).includes("Second child claim"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps a captured source ID bound to its locator and owning KB", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-source-identity-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "child-a", title: "Child A", actor: "human:test" });
    await executeOperation(root, { op: "create_kb", id: "child-b", title: "Child B", actor: "human:test" });
    await writeFile(join(root, "first.txt"), "first source observation\n", "utf8");
    await writeFile(join(root, "second.txt"), "second source observation\n", "utf8");
    const firstCapture = await executeOperation(root, {
      op: "capture_source",
      kb: "child-a",
      locator: "first.txt",
      actor: "human:test"
    });
    const sourceId = (firstCapture.data as { source: { id: string; locator: string } }).source.id;
    assert.equal((firstCapture.data as { source: { locator: string } }).source.locator, "first.txt");
    const beforeRejectedRetarget = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "capture_source",
        kb: "child-b",
        locator: "second.txt",
        sourceId,
        actor: "human:test"
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "CONFLICT");
        return true;
      }
    );
    const afterRejectedRetarget = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(afterRejectedRetarget.revision, beforeRejectedRetarget.revision);

    await assert.rejects(
      executeOperation(root, {
        op: "capture_source",
        kb: "child-b",
        locator: "first.txt",
        sourceId,
        actor: "human:test"
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SCOPE_VIOLATION");
        return true;
      }
    );
    const afterRejectedScope = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(afterRejectedScope.revision, afterRejectedRetarget.revision);

    const stillFirst = await executeOperation(root, {
      op: "capture_source",
      kb: "child-a",
      locator: "first.txt",
      sourceId,
      actor: "human:test"
    });
    const stillFirstData = stillFirst.data as { source: { id: string; locator: string }; changed: boolean };
    assert.equal(stillFirstData.source.id, sourceId);
    assert.equal(stillFirstData.source.locator, "first.txt");
    assert.equal(stillFirstData.changed, false);
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
    const unsupportedClaim = await executeOperation(root, {
      op: "why",
      nodeId: claimId,
      kb: "adr",
      evaluationTime: "2026-09-10T00:00:00Z"
    });
    assert.equal((unsupportedClaim.data as { support: { status: string } }).support.status, "pending");
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
      support: { status: string };
      originalBasis: { justification: { conclusion: string; groups: Array<{ premises: string[] }> } };
      upstream: Array<{ id: string }>;
      provenance: Array<{ sourceId: string; observationId: string; observedText: string; providerRevision: string }>;
    };
    const upstreamIds = new Set(explanation.upstream.map((node) => node.id));
    assert.equal(explanation.node.id, artifactData.node.id);
    assert.equal(explanation.originalBasis.justification.conclusion, artifactData.node.id);
    assert.deepEqual(explanation.originalBasis.justification.groups[0]?.premises, [decisionId]);
    assert.deepEqual([...upstreamIds].sort(), [decisionId, claimId, constraintId, capturedData.evidence.id, capturedData.source.nodeId].sort());
    assert.equal(explanation.support.status, "usable");
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

test("why evaluates AND support and time-bounded applicability independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-assessment-"));
  try {
    await initializeProject(root);
    const accepted = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "requirement",
      title: "Accepted requirement",
      body: "The accepted requirement is available.",
      fields: { accepted: true },
      actor: "human:test"
    });
    const acceptedId = (accepted.data as { node: { id: string } }).node.id;
    const unaccepted = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "requirement",
      title: "Unaccepted requirement",
      body: "The second required premise is awaiting acceptance.",
      fields: { accepted: false },
      actor: "human:test"
    });
    const unacceptedId = (unaccepted.data as { node: { id: string } }).node.id;
    const andClaim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Both requirements are met",
      body: "This claim needs both requirements.",
      actor: "human:test"
    });
    const andClaimId = (andClaim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      conclusion: andClaimId,
      groups: [[acceptedId, unacceptedId]],
      rationale: "Both requirements are needed for this claim.",
      actor: "human:test"
    });
    const andExplanation = await executeOperation(root, {
      op: "why",
      nodeId: andClaimId,
      evaluationTime: "2026-01-01T00:00:00Z"
    });
    const andData = andExplanation.data as {
      support: { status: string };
      currentSupport: Array<{ groups: Array<{ status: string }> }>;
    };
    assert.equal(andData.support.status, "pending");
    assert.equal(andData.currentSupport[0]?.groups[0]?.status, "pending");

    const future = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "requirement",
      title: "Future requirement",
      body: "This requirement starts in February.",
      fields: { accepted: true },
      applicability: { validFrom: "2026-02-01T00:00:00Z" },
      actor: "human:test"
    });
    const futureId = (future.data as { node: { id: string } }).node.id;
    const futureClaim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Future requirement can support this claim",
      body: "This claim is bounded by the future requirement.",
      actor: "human:test"
    });
    const futureClaimId = (futureClaim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      conclusion: futureClaimId,
      groups: [[futureId]],
      rationale: "The requirement becomes applicable in February.",
      actor: "human:test"
    });
    const beforeApplicability = await executeOperation(root, {
      op: "why",
      nodeId: futureClaimId,
      evaluationTime: "2026-01-31T23:59:59Z"
    });
    assert.equal((beforeApplicability.data as { support: { status: string } }).support.status, "pending");
    const afterApplicability = await executeOperation(root, {
      op: "why",
      nodeId: futureClaimId,
      evaluationTime: "2026-02-01T00:00:00Z"
    });
    assert.equal((afterApplicability.data as { support: { status: string } }).support.status, "usable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("why composes justification applicability into group status", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-justification-applicability-"));
  try {
    await initializeProject(root);
    const premise = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "requirement",
      title: "Accepted premise",
      body: "The premise itself remains accepted.",
      fields: { accepted: true },
      actor: "human:test"
    });
    const premiseId = (premise.data as { node: { id: string } }).node.id;
    const conclusion = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Time-bounded conclusion",
      body: "This conclusion was only supported before March.",
      actor: "human:test"
    });
    const conclusionId = (conclusion.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      conclusion: conclusionId,
      groups: [[premiseId]],
      rationale: "The accepted premise supported this conclusion during the declared interval.",
      applicability: { validUntil: "2026-03-01T00:00:00Z" },
      actor: "human:test"
    });
    const explanation = await executeOperation(root, {
      op: "why",
      nodeId: conclusionId,
      evaluationTime: "2026-03-02T00:00:00Z"
    });
    const data = explanation.data as {
      support: { status: string };
      currentSupport: Array<{ assessment: { status: string }; groups: Array<{ status: string }> }>;
    };
    assert.equal(data.support.status, "pending");
    assert.equal(data.currentSupport[0]?.assessment.status, "pending");
    assert.equal(data.currentSupport[0]?.groups[0]?.status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export preserves navigable source links, support groups, relationships and provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-export-reasoning-"));
  try {
    await initializeProject(root);
    const requirement = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "requirement",
      title: "Retain the benchmark",
      body: "The benchmark must be retained.",
      fields: { accepted: true },
      actor: "human:test"
    });
    const requirementId = (requirement.data as { node: { id: string } }).node.id;
    const sourceLocator = "evidence/benchmark.txt";
    const sourceText = "benchmark result: PASS\n";
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, sourceLocator), sourceText, "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      kb: "shared",
      locator: sourceLocator,
      actor: "human:test"
    });
    const capturedData = captured.data as {
      source: { id: string };
      observation: { id: string; providerRevision?: string; observedText?: string };
      evidence: { id: string };
    };
    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "The benchmark passed",
      body: "The retained benchmark reports a passing result.",
      links: [{ to: requirementId, type: "supports", rationale: "The claim fulfills the retention requirement." }],
      actor: "human:test"
    });
    const claimData = claim.data as { node: { id: string }; relationships: Array<{ id: string; createdAt: string }> };
    const claimId = claimData.node.id;
    await executeOperation(root, {
      op: "justify",
      conclusion: claimId,
      groups: [[capturedData.evidence.id, requirementId]],
      rationale: "The retained observation and accepted requirement jointly support the claim.",
      actor: "human:test"
    });
    const exported = await executeOperation(root, { op: "export" });
    assert.equal((exported.data as { historyIncluded: boolean }).historyIncluded, false);

    const claimDocument = await readFile(join(root, "kb", "shared", `${claimId}.md`), "utf8");
    const claimClosing = claimDocument.indexOf("\n---\n", 4);
    const claimFrontmatter = parseDocument(claimDocument.slice(4, claimClosing)).toJSON() as {
      justification?: {
        justifications?: Array<{ groups?: Array<{ premises?: string[] }> }>;
        relationships?: Array<{ from?: string; to?: string; type?: string }>;
        provenance?: Array<{ sourceId?: string; observationId?: string; observedText?: string; providerRevision?: string }>;
      };
    };
    const extension = claimFrontmatter.justification;
    assert.deepEqual(extension?.justifications?.[0]?.groups?.[0]?.premises, [capturedData.evidence.id, requirementId]);
    assert.deepEqual(extension?.relationships, [{
      id: claimData.relationships[0]?.id,
      kb: "shared",
      from: claimId,
      to: requirementId,
      type: "supports",
      rationale: "The claim fulfills the retention requirement.",
      createdBy: "human:test",
      createdAt: claimData.relationships[0]?.createdAt
    }]);
    assert.deepEqual(extension?.provenance, [{
      sourceId: capturedData.source.id,
      observationId: capturedData.observation.id,
      providerId: "file",
      locator: sourceLocator,
      providerRevision: capturedData.observation.providerRevision,
      digest: (capturedData.observation as { digest?: string }).digest,
      observedBytesDigest: (capturedData.observation as { observedBytesDigest?: string }).observedBytesDigest,
      observedText: sourceText,
      availability: "present"
    }]);
    assert.equal(claimDocument.includes(`Premises: [${capturedData.evidence.id}](${capturedData.evidence.id}.md), [${requirementId}](${requirementId}.md)`), true);
    const evidenceDocument = await readFile(join(root, "kb", "shared", `${capturedData.evidence.id}.md`), "utf8");
    assert.equal(evidenceDocument.includes(`Source: [${sourceLocator}](../../${sourceLocator})`), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refreshes changed evidence and exposes the exact ADR impact with durable review state", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-source-change-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "justification-runtime-source-change-second-"));
  try {
    await initializeProject(root);
    await initializeProject(secondRoot);
    const foreign = await executeOperation(secondRoot, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Foreign project claim",
      body: "This node belongs to a different project.",
      actor: "human:foreign"
    });
    const foreignNodeId = (foreign.data as { node: { id: string } }).node.id;
    const secondProjectBefore = await executeOperation(secondRoot, { op: "knowledge_bases" });

    const sourceLocator = "evidence/source.txt";
    const initialText = "benchmark result: PASS\ninitial source revision\n";
    const changedText = "benchmark result: FAIL\nchanged source revision\n";
    const initialDigest = createHash("sha256").update(initialText, "utf8").digest("hex");
    const changedDigest = createHash("sha256").update(changedText, "utf8").digest("hex");
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, sourceLocator), initialText, "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      kb: "shared",
      locator: sourceLocator,
      actor: "human:source"
    });
    const capturedData = captured.data as {
      source: { id: string; nodeId: string; currentObservationId?: string; currentDigest?: string };
      observation: { id: string; digest?: string; observedText?: string };
      evidence: { id: string; sourceId: string; observationId: string };
    };
    assert.equal(capturedData.observation.digest, initialDigest);
    assert.equal(capturedData.observation.observedText, initialText);
    assert.equal(capturedData.evidence.observationId, capturedData.observation.id);

    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "The benchmark passes",
      body: "The retained benchmark supports a passing result.",
      actor: "human:author"
    });
    const claimId = (claim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: claimId,
      groups: [[capturedData.evidence.id]],
      rationale: "The retained benchmark observation supports the claim.",
      actor: "human:author"
    });
    const decision = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "decision",
      title: "Choose the passing checkout design",
      body: "Select the design represented by the passing benchmark.",
      basis: [claimId],
      actor: "human:author"
    });
    const decisionId = (decision.data as { node: { id: string } }).node.id;
    const artifactLocator = "adr.md";
    await writeFile(join(root, artifactLocator), "# Checkout decision\n\nThe benchmark passes.\n", "utf8");
    const artifact = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "artifact",
      title: "Checkout ADR",
      body: "The generated ADR records the checkout decision.",
      basis: [decisionId],
      fields: { locator: artifactLocator },
      actor: "human:author"
    });
    const artifactId = (artifact.data as { node: { id: string } }).node.id;
    const historicalRevision = artifact.revision;
    const fixedEvaluationTime = "2026-09-10T12:00:00Z";
    const historicalWhyBefore = await executeOperation(root, {
      op: "why",
      nodeId: artifactId,
      kb: "shared",
      revision: historicalRevision,
      evaluationTime: fixedEvaluationTime
    });
    assert.equal((historicalWhyBefore.data as { support: { status: string } }).support.status, "usable");

    await writeFile(join(root, sourceLocator), changedText, "utf8");
    const refreshed = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      sourceIds: [capturedData.source.id],
      actor: "human:refresh",
      evaluationTime: "2026-09-10T13:00:00Z"
    });
    assert.equal(refreshed.revision, historicalRevision + 1);
    const refreshData = refreshed.data as {
      changed: boolean;
      sources: Array<{ id: string; currentObservationId?: string; currentDigest?: string }>;
      observations: Array<{ id: string; sourceId: string; digest?: string; observedText?: string; observedBytesDigest?: string; providerRevision?: string }>;
      changes: Array<{ id: string; sourceId: string; beforeObservationId?: string; afterObservationId?: string; beforeDigest?: string; afterDigest?: string; reason: string }>;
      reviews: Array<{ id: string; nodeId: string; triggerType: string; triggerId: string; status: string }>;
    };
    assert.equal(refreshData.changed, true);
    assert.equal(refreshData.sources.length, 1);
    assert.equal(refreshData.sources[0]?.id, capturedData.source.id);
    assert.equal(refreshData.sources[0]?.currentDigest, changedDigest);
    assert.equal(refreshData.observations.length, 1);
    const newObservation = refreshData.observations[0];
    assert.ok(newObservation);
    assert.notEqual(newObservation.id, capturedData.observation.id);
    assert.equal(newObservation.sourceId, capturedData.source.id);
    assert.equal(newObservation.digest, changedDigest);
    assert.equal(newObservation.observedText, changedText);
    assert.equal(newObservation.observedBytesDigest, changedDigest);
    assert.equal(newObservation.providerRevision, `sha256:${changedDigest}`);
    assert.equal(refreshData.changes.length, 1);
    const change = refreshData.changes[0];
    assert.ok(change);
    assert.equal(change.sourceId, capturedData.source.id);
    assert.equal(change.beforeObservationId, capturedData.observation.id);
    assert.equal(change.afterObservationId, newObservation.id);
    assert.equal(change.beforeDigest, initialDigest);
    assert.equal(change.afterDigest, changedDigest);
    assert.equal(change.reason, "content_changed");

    const expectedReviewNodeIds = new Set([capturedData.evidence.id, claimId, decisionId, artifactId]);
    assert.deepEqual(new Set(refreshData.reviews.map((review) => review.nodeId)), expectedReviewNodeIds);
    assert.equal(refreshData.reviews.every((review) => review.triggerType === "change" && review.triggerId === change.id && review.status === "open"), true);

    const inspected = await executeOperation(root, { op: "inspect_source", sourceId: capturedData.source.id, kb: "shared" });
    const inspectedData = inspected.data as {
      source: { id: string; currentObservationId?: string; currentDigest?: string };
      observations: Array<{ id: string; digest?: string; observedText?: string }>;
      evidence: Array<{ id: string; sourceId?: string; observationId?: string }>;
      changes: Array<{ id: string }>;
    };
    assert.equal(inspectedData.source.currentObservationId, newObservation.id);
    assert.equal(inspectedData.source.currentDigest, changedDigest);
    assert.deepEqual(inspectedData.observations.map((observation) => observation.id), [capturedData.observation.id, newObservation.id]);
    assert.equal(inspectedData.observations[0]?.digest, initialDigest);
    assert.equal(inspectedData.observations[0]?.observedText, initialText);
    assert.equal(inspectedData.observations[1]?.digest, changedDigest);
    assert.equal(inspectedData.observations[1]?.observedText, changedText);
    assert.equal(inspectedData.evidence.length, 2);
    const newEvidence = inspectedData.evidence.find((evidence) => evidence.observationId === newObservation.id);
    assert.ok(newEvidence);
    assert.equal(newEvidence.sourceId, capturedData.source.id);
    assert.deepEqual(inspectedData.changes.map((entry) => entry.id), [change.id]);

    const evidenceQuery = await executeOperation(root, { op: "evidence", sourceId: capturedData.source.id, kb: "shared" });
    const evidenceData = evidenceQuery.data as {
      source: { id: string };
      observations: Array<{ id: string }>;
      evidence: Array<{ id: string; observationId?: string }>;
      changes: Array<{ id: string; beforeObservationId?: string; afterObservationId?: string }>;
    };
    assert.equal(evidenceData.source.id, capturedData.source.id);
    assert.deepEqual(evidenceData.observations.map((observation) => observation.id), [capturedData.observation.id, newObservation.id]);
    assert.deepEqual(evidenceData.evidence.map((entry) => entry.observationId), [capturedData.observation.id, newObservation.id]);
    assert.deepEqual(evidenceData.changes.map((entry) => ({ id: entry.id, before: entry.beforeObservationId, after: entry.afterObservationId })), [{ id: change.id, before: capturedData.observation.id, after: newObservation.id }]);

    const changedQuery = await executeOperation(root, { op: "changed", sourceId: capturedData.source.id, kb: "shared" });
    const changedData = changedQuery.data as {
      sources: Array<{ id: string }>;
      observations: Array<{ id: string; digest?: string }>;
      changes: Array<{ id: string }>;
    };
    assert.deepEqual(changedData.sources.map((source) => source.id), [capturedData.source.id]);
    assert.deepEqual(changedData.observations.map((observation) => ({ id: observation.id, digest: observation.digest })), [{ id: capturedData.observation.id, digest: initialDigest }, { id: newObservation.id, digest: changedDigest }]);
    assert.deepEqual(changedData.changes.map((entry) => entry.id), [change.id]);

    const impact = await executeOperation(root, {
      op: "impact",
      nodeId: capturedData.source.nodeId,
      kb: "shared",
      evaluationTime: "2026-09-10T13:00:00Z"
    });
    const impactData = impact.data as {
      node: { id: string };
      affected: Array<{ node: { id: string }; paths: string[][]; reasons: string[] }>;
      changes: Array<{ id: string }>;
      reviews: Array<{ nodeId: string; triggerId: string; status: string }>;
    };
    const expectedImpactPaths = new Map<string, string[][]>([
      [capturedData.evidence.id, [[capturedData.source.nodeId, capturedData.evidence.id]]],
      [newEvidence.id, [[capturedData.source.nodeId, newEvidence.id]]],
      [claimId, [[capturedData.source.nodeId, capturedData.evidence.id, claimId]]],
      [decisionId, [[capturedData.source.nodeId, capturedData.evidence.id, claimId, decisionId]]],
      [artifactId, [[capturedData.source.nodeId, capturedData.evidence.id, claimId, decisionId, artifactId]]]
    ]);
    assert.equal(impactData.node.id, capturedData.source.nodeId);
    assert.deepEqual(new Set(impactData.affected.map((entry) => entry.node.id)), new Set(expectedImpactPaths.keys()));
    for (const entry of impactData.affected) {
      assert.deepEqual(entry.paths, expectedImpactPaths.get(entry.node.id));
      assert.equal(entry.reasons.length > 0, true);
    }
    assert.deepEqual(impactData.changes.map((entry) => entry.id), [change.id]);
    assert.deepEqual(new Set(impactData.reviews.map((review) => review.nodeId)), expectedReviewNodeIds);
    assert.equal(impactData.reviews.every((review) => review.triggerId === change.id && review.status === "open"), true);

    const reviewQuery = await executeOperation(root, { op: "review", kb: "shared" });
    const reviewData = reviewQuery.data as {
      reviews: Array<{ nodeId: string; triggerType: string; triggerId: string; status: string }>;
      changes: Array<{ id: string }>;
    };
    assert.deepEqual(new Set(reviewData.reviews.map((review) => review.nodeId)), expectedReviewNodeIds);
    assert.equal(reviewData.reviews.every((review) => review.triggerType === "change" && review.triggerId === change.id && review.status === "open"), true);
    assert.deepEqual(reviewData.changes.map((entry) => entry.id), [change.id]);

    const currentWhy = await executeOperation(root, {
      op: "why",
      nodeId: artifactId,
      kb: "shared",
      evaluationTime: "2026-09-10T13:00:00Z"
    });
    const currentWhyData = currentWhy.data as {
      support: { status: string };
      reviews: Array<{ nodeId: string; status: string }>;
      changes: Array<{ id: string }>;
      evidence: Array<{ id: string }>;
      observations: Array<{ id: string }>;
    };
    assert.equal(currentWhyData.support.status, "pending");
    assert.deepEqual(new Set(currentWhyData.reviews.map((review) => review.nodeId)), expectedReviewNodeIds);
    assert.equal(currentWhyData.reviews.every((review) => review.status === "open"), true);
    assert.deepEqual(currentWhyData.changes.map((entry) => entry.id), [change.id]);
    assert.equal(currentWhyData.evidence.some((entry) => entry.id === capturedData.evidence.id), true);
    assert.equal(currentWhyData.evidence.some((entry) => entry.id === newEvidence.id), true);
    assert.equal(currentWhyData.observations.some((entry) => entry.id === capturedData.observation.id), true);
    assert.equal(currentWhyData.observations.some((entry) => entry.id === newObservation.id), true);

    const historicalWhyAfter = await executeOperation(root, {
      op: "why",
      nodeId: artifactId,
      kb: "shared",
      revision: historicalRevision,
      evaluationTime: fixedEvaluationTime
    });
    assert.deepEqual(historicalWhyAfter, historicalWhyBefore);

    const unchangedRefresh = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      sourceIds: [capturedData.source.id],
      actor: "human:refresh",
      evaluationTime: "2026-09-10T14:00:00Z"
    });
    assert.equal(unchangedRefresh.revision, refreshed.revision);
    const unchangedData = unchangedRefresh.data as { changed: boolean; observations: unknown[]; changes: unknown[]; reviews: unknown[] };
    assert.equal(unchangedData.changed, false);
    assert.deepEqual(unchangedData.observations, []);
    assert.deepEqual(unchangedData.changes, []);
    assert.deepEqual(unchangedData.reviews, []);
    const reviewsAfterUnchanged = await executeOperation(root, { op: "review", kb: "shared" });
    assert.deepEqual((reviewsAfterUnchanged.data as { reviews: Array<{ nodeId: string }> }).reviews.map((review) => review.nodeId), reviewData.reviews.map((review) => review.nodeId));

    const secondProjectAfter = await executeOperation(secondRoot, { op: "knowledge_bases" });
    assert.equal(secondProjectAfter.revision, secondProjectBefore.revision);
    await assert.rejects(
      executeOperation(secondRoot, { op: "why", nodeId: artifactId, kb: "shared", evaluationTime: "2026-09-10T13:00:00Z" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "NOT_FOUND");
        return true;
      }
    );
    await assert.rejects(
      executeOperation(root, { op: "why", nodeId: foreignNodeId, kb: "shared", evaluationTime: "2026-09-10T13:00:00Z" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "NOT_FOUND");
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});

test("scopes a refresh response while retaining shared-source reviews for each child", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-scoped-refresh-reviews-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "child-a", title: "Child A", actor: "human:test" });
    await executeOperation(root, { op: "create_kb", id: "child-b", title: "Child B", actor: "human:test" });
    const sourceLocator = "evidence/shared-source.txt";
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, sourceLocator), "shared source: initial\n", "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      kb: "shared",
      locator: sourceLocator,
      actor: "human:source"
    });
    const capturedData = captured.data as { source: { id: string }; evidence: { id: string } };

    const childAClaim = await executeOperation(root, {
      op: "record",
      kb: "child-a",
      kind: "claim",
      title: "Child A claim",
      body: "Child A relies on the shared source.",
      actor: "human:a"
    });
    const childAClaimId = (childAClaim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "child-a",
      conclusion: childAClaimId,
      groups: [[capturedData.evidence.id]],
      rationale: "The shared observation supports child A.",
      actor: "human:a"
    });

    const childBClaim = await executeOperation(root, {
      op: "record",
      kb: "child-b",
      kind: "claim",
      title: "Child B claim",
      body: "Child B relies on the shared source.",
      actor: "human:b"
    });
    const childBClaimId = (childBClaim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "child-b",
      conclusion: childBClaimId,
      groups: [[capturedData.evidence.id]],
      rationale: "The shared observation supports child B.",
      actor: "human:b"
    });

    await writeFile(join(root, sourceLocator), "shared source: changed\n", "utf8");
    const refreshed = await executeOperation(root, {
      op: "refresh",
      kb: "child-a",
      sourceIds: [capturedData.source.id],
      actor: "human:refresh"
    });
    const refreshData = refreshed.data as { reviews: Array<{ nodeId: string }> };
    const returnedReviewNodeIds = new Set(refreshData.reviews.map((review) => review.nodeId));
    assert.equal(returnedReviewNodeIds.has(childAClaimId), true);
    assert.equal(returnedReviewNodeIds.has(capturedData.evidence.id), true);
    assert.equal(returnedReviewNodeIds.has(childBClaimId), false);

    const childBReviews = await executeOperation(root, { op: "review", kb: "child-b" });
    const childBReviewNodeIds = new Set((childBReviews.data as { reviews: Array<{ nodeId: string }> }).reviews.map((review) => review.nodeId));
    assert.equal(childBReviewNodeIds.has(childBClaimId), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reopens the original retained basis when a restored source changes again", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-source-repeated-change-"));
  try {
    await initializeProject(root);
    const sourceLocator = "research/source.txt";
    const sourceA = "research result: A\n";
    const sourceB = "research result: B\n";
    const sourceC = "research result: C\n";
    await mkdir(join(root, "research"), { recursive: true });
    await writeFile(join(root, sourceLocator), sourceA, "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      kb: "shared",
      locator: sourceLocator,
      actor: "human:source"
    });
    const capturedData = captured.data as { source: { id: string }; evidence: { id: string } };

    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Research result A is retained",
      body: "The initial research observation supports this claim.",
      actor: "human:researcher"
    });
    const claimId = (claim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: claimId,
      groups: [[capturedData.evidence.id]],
      rationale: "The retained A observation supports the claim.",
      actor: "human:researcher"
    });
    const output = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "artifact",
      title: "Research output",
      body: "A research output based directly on the retained claim.",
      basis: [claimId],
      actor: "human:researcher"
    });
    const outputId = (output.data as { node: { id: string } }).node.id;

    await writeFile(join(root, sourceLocator), sourceB, "utf8");
    await executeOperation(root, {
      op: "refresh",
      sourceIds: [capturedData.source.id],
      actor: "human:refresh"
    });
    await writeFile(join(root, sourceLocator), sourceA, "utf8");
    const restored = await executeOperation(root, {
      op: "refresh",
      sourceIds: [capturedData.source.id],
      actor: "human:refresh"
    });
    const restoredWhy = await executeOperation(root, { op: "why", nodeId: claimId, kb: "shared" });
    assert.equal((restoredWhy.data as { support: { status: string } }).support.status, "usable");
    const restoredOutputWhy = await executeOperation(root, { op: "why", nodeId: outputId, kb: "shared" });
    assert.equal((restoredOutputWhy.data as { support: { status: string } }).support.status, "usable");

    await writeFile(join(root, sourceLocator), sourceC, "utf8");
    const changedAgain = await executeOperation(root, {
      op: "refresh",
      sourceIds: [capturedData.source.id],
      actor: "human:refresh"
    });
    const latestChange = (changedAgain.data as { changes: Array<{ id: string }> }).changes[0];
    assert.ok(latestChange);
    const changedWhy = await executeOperation(root, { op: "why", nodeId: claimId, kb: "shared" });
    assert.equal((changedWhy.data as { support: { status: string } }).support.status, "pending");
    const changedOutputWhy = await executeOperation(root, { op: "why", nodeId: outputId, kb: "shared" });
    assert.equal((changedOutputWhy.data as { support: { status: string } }).support.status, "pending");

    const reviews = await executeOperation(root, { op: "review", kb: "shared" });
    const latestReviews = (reviews.data as { reviews: Array<{ nodeId: string; triggerId: string }> }).reviews.filter((review) => review.triggerId === latestChange.id);
    const latestReviewNodeIds = new Set(latestReviews.map((review) => review.nodeId));
    assert.equal(latestReviewNodeIds.has(capturedData.evidence.id), true);
    assert.equal(latestReviewNodeIds.has(claimId), true);
    assert.equal(latestReviewNodeIds.has(outputId), true);
    assert.equal(latestReviews.length > 0, true);
    assert.equal(restored.revision < changedAgain.revision, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records inaccessible source availability as a durable review transition", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-source-unavailable-"));
  const sourceDirectory = join(root, "research");
  try {
    await initializeProject(root);
    const sourceLocator = "research/source.txt";
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(join(root, sourceLocator), "research result: retained\n", "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      kb: "shared",
      locator: sourceLocator,
      actor: "human:source"
    });
    const capturedData = captured.data as { source: { id: string }; evidence: { id: string } };
    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "The retained research is available",
      body: "The source observation supports this claim.",
      actor: "human:researcher"
    });
    const claimId = (claim.data as { node: { id: string } }).node.id;
    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: claimId,
      groups: [[capturedData.evidence.id]],
      rationale: "The retained observation supports the claim.",
      actor: "human:researcher"
    });
    const output = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "artifact",
      title: "Research output",
      body: "A direct output based on the research claim.",
      basis: [claimId],
      actor: "human:researcher"
    });
    const outputId = (output.data as { node: { id: string } }).node.id;

    await chmod(sourceDirectory, 0o000);
    let refreshed: Awaited<ReturnType<typeof executeOperation>>;
    try {
      refreshed = await executeOperation(root, {
        op: "refresh",
        sourceIds: [capturedData.source.id],
        actor: "human:refresh"
      });
    } finally {
      await chmod(sourceDirectory, 0o755);
    }
    const refreshData = refreshed.data as {
      changed: boolean;
      sources: Array<{ availability: string }>;
      observations: Array<{ availability: string }>;
      changes: Array<{ id: string; reason: string; afterAvailability: string }>;
      reviews: Array<{ nodeId: string; triggerId: string }>;
    };
    assert.equal(refreshData.changed, true);
    assert.equal(["unavailable", "denied"].includes(refreshData.sources[0]?.availability ?? ""), true);
    assert.equal(["unavailable", "denied"].includes(refreshData.observations[0]?.availability ?? ""), true);
    assert.equal(refreshData.changes[0]?.reason, "availability_changed");
    assert.equal(["unavailable", "denied"].includes(refreshData.changes[0]?.afterAvailability ?? ""), true);
    const latestChangeId = refreshData.changes[0]?.id;
    assert.ok(latestChangeId);
    const reviewNodeIds = new Set(refreshData.reviews.filter((review) => review.triggerId === latestChangeId).map((review) => review.nodeId));
    assert.equal(reviewNodeIds.has(capturedData.evidence.id), true);
    assert.equal(reviewNodeIds.has(claimId), true);
    assert.equal(reviewNodeIds.has(outputId), true);
    const claimWhy = await executeOperation(root, { op: "why", nodeId: claimId, kb: "shared" });
    assert.equal((claimWhy.data as { support: { status: string } }).support.status, "pending");
  } finally {
    await chmod(sourceDirectory, 0o755).catch(() => undefined);
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
