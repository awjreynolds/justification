#!/usr/bin/env node

/**
 * Run the fictional checkout-cache ADR proof against the built public runtime.
 *
 * The script intentionally creates its own project roots. Pass --root to keep
 * the generated projects in an existing empty directory; without it a new
 * temporary directory is created and left in place for inspection.
 */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";

import { executeOperation, initializeProject } from "../dist/index.js";

const ACTOR = "fixture-agent";
const EVALUATION_TIME = "2026-01-01T00:00:00.000Z";
const CHILD_KB = "checkout-cache";

const INITIAL_BENCHMARK = `# Fictional cache benchmark

fixture-version: 1

| Option | p95 miss latency | Survives process restart |
| --- | ---: | --- |
| Redis | 82 ms | yes |
| SQLite | 191 ms | yes |
| Memory | 41 ms | no |
`;

const CHANGED_BENCHMARK = `# Fictional cache benchmark

fixture-version: 2

| Option | p95 miss latency | Survives process restart |
| --- | ---: | --- |
| Redis | 171 ms | yes |
| SQLite | 191 ms | yes |
| Memory | 41 ms | no |
`;

const ADR_TEXT = `# ADR-0001: Choose Redis for the checkout cache

Status: accepted

The checkout-cache experiment selects Redis because the fictional benchmark
keeps its p95 miss latency below the shared 150 ms constraint and survives a
process restart.
`;

function parseArgs(argv) {
  if (argv.length === 0) return { root: undefined };
  if (argv.length === 2 && argv[0] === "--root") return { root: resolve(argv[1]) };
  throw new Error("usage: node examples/adr-demo.mjs [--root EMPTY_DIRECTORY]");
}

async function prepareWorkspace(requestedRoot) {
  if (requestedRoot === undefined) {
    return mkdtemp(join(tmpdir(), "justification-adr-demo-"));
  }

  await mkdir(requestedRoot, { recursive: true });
  const info = await stat(requestedRoot);
  if (!info.isDirectory()) throw new Error(`--root is not a directory: ${requestedRoot}`);
  const entries = await readdir(requestedRoot);
  if (entries.length !== 0) {
    throw new Error(`--root must be empty; refusing to write into ${requestedRoot}`);
  }
  return requestedRoot;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function recordNodeId(response, expectedKind) {
  const node = response?.data?.node;
  assert.ok(node && typeof node === "object", "record response must contain data.node");
  assert.equal(node.kind, expectedKind, `record response kind must be ${expectedKind}`);
  assert.equal(typeof node.id, "string", "record response node.id must be a string");
  return node.id;
}

function captureIds(response) {
  const data = response?.data;
  assert.ok(data && typeof data === "object", "capture response must contain data");
  assert.ok(data.source && typeof data.source === "object", "capture response must contain data.source");
  assert.ok(data.observation && typeof data.observation === "object", "capture response must contain data.observation");
  assert.ok(data.evidence && typeof data.evidence === "object", "capture response must contain data.evidence");
  assert.equal(typeof data.source.id, "string", "source.id must be a string");
  assert.equal(typeof data.source.nodeId, "string", "source.nodeId must be a string");
  assert.equal(typeof data.observation.id, "string", "observation.id must be a string");
  assert.equal(typeof data.evidence.id, "string", "evidence.id must be a string");
  assert.equal(data.evidence.sourceId, data.source.id, "evidence must point to the provider source ID");
  assert.equal(data.evidence.observationId, data.observation.id, "evidence must point to its retained observation");
  return {
    sourceId: data.source.id,
    sourceNodeId: data.source.nodeId,
    observationId: data.observation.id,
    evidenceId: data.evidence.id
  };
}

function sortedIds(nodes, label) {
  assert.ok(Array.isArray(nodes), `${label} must be an array`);
  return nodes.map((node) => {
    assert.ok(node && typeof node === "object", `${label} entries must be objects`);
    assert.equal(typeof node.id, "string", `${label} entries must have IDs`);
    return node.id;
  }).sort();
}

function dataOf(response) {
  assert.equal(typeof response, "object");
  assert.equal(typeof response.revision, "number");
  return response.data;
}

async function run() {
  const { root: requestedRoot } = parseArgs(process.argv.slice(2));
  const workspace = await prepareWorkspace(requestedRoot);
  const projectA = join(workspace, "acme-checkout");
  const projectB = join(workspace, "acme-search");
  const sourceLocator = "evidence/cache-benchmark.md";
  const artifactLocator = "adr/ADR-0001.md";

  await mkdir(join(projectA, "evidence"), { recursive: true });
  await mkdir(join(projectA, "adr"), { recursive: true });
  await writeFile(join(projectA, sourceLocator), INITIAL_BENCHMARK, "utf8");
  await writeFile(join(projectA, artifactLocator), ADR_TEXT, "utf8");
  await mkdir(projectB, { recursive: true });
  await writeFile(join(projectB, "README.md"), "Unrelated fictional project.\n", "utf8");

  await initializeProject(projectA);
  await initializeProject(projectB);

  const projectBKbs = await executeOperation(projectB, { op: "knowledge_bases" });
  assert.equal(projectBKbs.revision, 0, "the unrelated project starts at revision zero");

  await executeOperation(projectA, {
    op: "create_kb",
    id: CHILD_KB,
    title: "Checkout cache experiment",
    actor: ACTOR
  });

  const constraintResponse = await executeOperation(projectA, {
    op: "record",
    kb: "shared",
    kind: "requirement",
    title: "Checkout p95 latency constraint",
    body: "Checkout reads must stay below 150 ms at p95, including a cache miss.",
    fields: { accepted: true },
    actor: ACTOR
  });
  const constraintId = recordNodeId(constraintResponse, "requirement");

  const optionIds = {};
  for (const [title, body] of [
    ["Redis", "Managed Redis-compatible cache with replication."],
    ["SQLite", "Local SQLite database on the application host."],
    ["Memory", "In-process LRU cache."]
  ]) {
    const response = await executeOperation(projectA, {
      op: "record",
      kb: CHILD_KB,
      kind: "option",
      title,
      body,
      actor: ACTOR
    });
    optionIds[title] = recordNodeId(response, "option");
  }

  const captureResponse = await executeOperation(projectA, {
    op: "capture_source",
    kb: CHILD_KB,
    locator: sourceLocator,
    title: "Fictional cache benchmark",
    actor: ACTOR
  });
  const { sourceId, sourceNodeId, observationId, evidenceId } = captureIds(captureResponse);
  assert.equal(captureResponse.data.observation.observedText, INITIAL_BENCHMARK);
  assert.equal(captureResponse.data.evidence.body, INITIAL_BENCHMARK);

  const claimResponse = await executeOperation(projectA, {
    op: "record",
    kb: CHILD_KB,
    kind: "claim",
    title: "Redis is the only qualifying cache option",
    body: "Within this fictional benchmark, Redis is the only option meeting the latency and restart requirements.",
    actor: ACTOR
  });
  const claimId = recordNodeId(claimResponse, "claim");

  const claimJustificationResponse = await executeOperation(projectA, {
    op: "justify",
    conclusion: claimId,
    groups: [[constraintId, evidenceId]],
    rationale: "The retained benchmark and the shared constraint jointly support this fictional claim.",
    kb: CHILD_KB,
    actor: ACTOR
  });
  assert.equal(claimJustificationResponse.data.justification.conclusion, claimId);
  assert.deepEqual(
    [...claimJustificationResponse.data.justification.groups[0].premises].sort(),
    [constraintId, evidenceId].sort()
  );

  const decisionResponse = await executeOperation(projectA, {
    op: "record",
    kb: CHILD_KB,
    kind: "decision",
    title: "Choose Redis for the checkout cache",
    body: "Select Redis for the checkout cache in the fictional experiment.",
    basis: [constraintId, claimId],
    fields: {
      consideredOptions: [optionIds.Redis, optionIds.SQLite, optionIds.Memory],
      selectedOption: optionIds.Redis,
      rationale: "Redis alone meets both declared requirements in the retained benchmark."
    },
    actor: ACTOR
  });
  const decisionId = recordNodeId(decisionResponse, "decision");
  const acceptanceRevision = decisionResponse.revision;

  const artifactResponse = await executeOperation(projectA, {
    op: "record",
    kb: CHILD_KB,
    kind: "artifact",
    title: "ADR-0001: Choose Redis for the checkout cache",
    body: ADR_TEXT,
    basis: [decisionId],
    fields: {
      locator: artifactLocator,
      digest: sha256(ADR_TEXT)
    },
    actor: ACTOR
  });
  const artifactId = recordNodeId(artifactResponse, "artifact");

  const historicalBefore = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    revision: acceptanceRevision,
    evaluationTime: EVALUATION_TIME
  });
  const historicalData = dataOf(historicalBefore);
  assert.equal(historicalData.node.id, decisionId);
  assert.equal(historicalData.support.status, "usable");
  assert.equal(historicalData.originalBasis.recordedAtRevision, acceptanceRevision);
  assert.equal(historicalData.originalBasis.justification.conclusion, decisionId);
  assert.deepEqual(
    [...historicalData.originalBasis.justification.groups[0].premises].sort(),
    [constraintId, claimId].sort()
  );
  assert.deepEqual(
    sortedIds(historicalData.upstream, "historical upstream"),
    [claimId, constraintId, evidenceId, sourceNodeId].sort()
  );
  assert.equal(historicalData.provenance.length, 1);
  assert.equal(historicalData.provenance[0].sourceId, sourceId);
  assert.equal(historicalData.provenance[0].observationId, observationId);
  assert.equal(historicalData.provenance[0].observedText, INITIAL_BENCHMARK);

  const currentBefore = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    evaluationTime: EVALUATION_TIME
  });
  const currentBeforeData = dataOf(currentBefore);
  assert.equal(currentBeforeData.support.status, "usable");
  assert.deepEqual(
    sortedIds(currentBeforeData.upstream, "current upstream"),
    [claimId, constraintId, evidenceId, sourceNodeId].sort()
  );
  assert.equal(currentBeforeData.provenance[0].observedText, INITIAL_BENCHMARK);

  await writeFile(join(projectA, sourceLocator), CHANGED_BENCHMARK, "utf8");
  const refreshResponse = await executeOperation(projectA, {
    op: "refresh",
    kb: CHILD_KB,
    actor: ACTOR,
    evaluationTime: EVALUATION_TIME
  });
  assert.ok(refreshResponse.revision > currentBefore.revision);

  const currentAfter = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    evaluationTime: EVALUATION_TIME
  });
  const currentAfterData = dataOf(currentAfter);
  assert.equal(currentAfterData.node.id, decisionId);
  assert.equal(currentAfterData.support.status, "pending");
  assert.deepEqual(
    sortedIds(currentAfterData.upstream, "current upstream after change"),
    [claimId, constraintId, evidenceId, sourceNodeId].sort()
  );
  assert.equal(currentAfterData.provenance[0].observedText, INITIAL_BENCHMARK);

  const unchangedRefresh = await executeOperation(projectA, {
    op: "refresh",
    kb: CHILD_KB,
    actor: ACTOR,
    evaluationTime: EVALUATION_TIME
  });
  assert.equal(
    unchangedRefresh.revision,
    refreshResponse.revision,
    "refreshing unchanged bytes creates no semantic revision"
  );

  const historicalAfter = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    revision: acceptanceRevision,
    evaluationTime: EVALUATION_TIME
  });
  assert.deepEqual(historicalAfter.data, historicalBefore.data);

  const beforeRebuild = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    evaluationTime: EVALUATION_TIME
  });
  await rm(join(projectA, ".justification"), { recursive: true, force: true });
  const rebuildResponse = await executeOperation(projectA, { op: "rebuild", actor: ACTOR });
  assert.equal(rebuildResponse.revision, beforeRebuild.revision);
  const afterRebuild = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    evaluationTime: EVALUATION_TIME
  });
  assert.deepEqual(afterRebuild.data, beforeRebuild.data);

  const projectBAfter = await executeOperation(projectB, { op: "knowledge_bases" });
  assert.equal(projectBAfter.revision, projectBKbs.revision, "the unrelated project is unchanged");

  console.log(JSON.stringify({
    ok: true,
    projects: [projectA, projectB],
    projectRoot: workspace,
    childKnowledgeBase: CHILD_KB,
    ids: { sourceId, sourceNodeId, observationId, evidenceId, claimId, decisionId, artifactId },
    acceptanceRevision,
    changedRevision: refreshResponse.revision,
    unchangedRefreshRevision: unchangedRefresh.revision,
    rebuiltRevision: rebuildResponse.revision,
    historicalWhyRevision: acceptanceRevision,
    currentReview: "changed source is visible through evidence, claim, decision and artifact"
  }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
});
