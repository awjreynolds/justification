#!/usr/bin/env node

/**
 * Run a general knowledge-output proof against the built public runtime.
 *
 * The fixture writes two fictional research sources, records independently
 * justified claims, and generates a research brief whose basis names the
 * survey claim directly. Pass --root to keep the generated project in an existing
 * empty directory; without it a new temporary directory is created and left
 * in place for inspection.
 */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";

import { executeOperation, initializeProject } from "../dist/index.js";

const ACTOR = "output-demo-agent";
const EVALUATION_TIME = "2026-01-01T00:00:00.000Z";
const RESEARCH_KB = "research";

const INITIAL_SURVEY = `# Fictional product survey

survey-version: 1

| Preference | Responses |
| --- | ---: |
| Weekly product summary | 18 |
| Monthly product summary | 7 |
| No summary | 2 |
`;

const CHANGED_SURVEY = `# Fictional product survey

survey-version: 2

| Preference | Responses |
| --- | ---: |
| Weekly product summary | 9 |
| Monthly product summary | 16 |
| No summary | 2 |
`;

const INDEPENDENT_NOTES = `# Independent field notes

notes-version: 1

Three fictional interviews found that participants wanted a clearer first-run
explanation of the product's export controls.
`;

function parseArgs(argv) {
  if (argv.length === 0) return { root: undefined };
  if (argv.length === 2 && argv[0] === "--root") return { root: resolve(argv[1]) };
  throw new Error("usage: node examples/knowledge-output-demo.mjs [--root EMPTY_DIRECTORY]");
}

async function prepareWorkspace(requestedRoot) {
  if (requestedRoot === undefined) {
    return mkdtemp(join(tmpdir(), "justification-knowledge-output-demo-"));
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

function dataOf(response) {
  assert.ok(response && typeof response === "object", "runtime response must be an object");
  assert.equal(typeof response.revision, "number", "runtime response must contain a revision");
  assert.ok(response.data && typeof response.data === "object", "runtime response must contain data");
  return response.data;
}

function recordNodeId(response, expectedKind) {
  const node = dataOf(response).node;
  assert.ok(node && typeof node === "object", "record response must contain data.node");
  assert.equal(node.kind, expectedKind, `record response kind must be ${expectedKind}`);
  assert.equal(typeof node.id, "string", "record response node.id must be a string");
  return node.id;
}

function captureIds(response) {
  const data = dataOf(response);
  assert.ok(data.source && typeof data.source === "object", "capture response must contain data.source");
  assert.ok(data.observation && typeof data.observation === "object", "capture response must contain data.observation");
  assert.ok(data.evidence && typeof data.evidence === "object", "capture response must contain data.evidence");
  assert.equal(typeof data.source.id, "string", "source.id must be a string");
  assert.equal(typeof data.source.nodeId, "string", "source.nodeId must be a string");
  assert.equal(typeof data.observation.id, "string", "observation.id must be a string");
  assert.equal(typeof data.evidence.id, "string", "evidence.id must be a string");
  assert.equal(data.evidence.sourceId, data.source.id, "evidence must point to its provider source");
  assert.equal(data.evidence.observationId, data.observation.id, "evidence must point to its retained observation");
  return {
    sourceId: data.source.id,
    sourceNodeId: data.source.nodeId,
    observationId: data.observation.id,
    evidenceId: data.evidence.id
  };
}

function nodeIds(entries, label) {
  assert.ok(Array.isArray(entries), `${label} must be an array`);
  return entries.map((entry) => {
    const node = entry?.node ?? entry;
    assert.ok(node && typeof node === "object", `${label} entries must be objects`);
    assert.equal(typeof node.id, "string", `${label} entries must have IDs`);
    return node.id;
  }).sort();
}

function reviewNodeIds(entries, label) {
  assert.ok(Array.isArray(entries), `${label} must be an array`);
  return entries.map((entry) => {
    assert.ok(entry && typeof entry === "object", `${label} entries must be objects`);
    assert.equal(typeof entry.nodeId, "string", `${label} entries must have nodeId`);
    return entry.nodeId;
  }).sort();
}

async function run() {
  const { root: requestedRoot } = parseArgs(process.argv.slice(2));
  const workspace = await prepareWorkspace(requestedRoot);
  const projectRoot = join(workspace, "product-research");
  const surveyLocator = "sources/product-survey.md";
  const notesLocator = "sources/independent-notes.md";
  const outputLocator = "outputs/research-brief.md";

  await mkdir(join(projectRoot, "sources"), { recursive: true });
  await mkdir(join(projectRoot, "outputs"), { recursive: true });
  await writeFile(join(projectRoot, surveyLocator), INITIAL_SURVEY, "utf8");
  await writeFile(join(projectRoot, notesLocator), INDEPENDENT_NOTES, "utf8");
  await initializeProject(projectRoot);

  await executeOperation(projectRoot, {
    op: "create_kb",
    id: RESEARCH_KB,
    title: "Fictional product research",
    actor: ACTOR
  });

  const surveyCapture = await executeOperation(projectRoot, {
    op: "capture_source",
    kb: RESEARCH_KB,
    locator: surveyLocator,
    title: "Fictional product survey",
    actor: ACTOR
  });
  const survey = captureIds(surveyCapture);
  assert.equal(dataOf(surveyCapture).observation.observedText, INITIAL_SURVEY);

  const notesCapture = await executeOperation(projectRoot, {
    op: "capture_source",
    kb: RESEARCH_KB,
    locator: notesLocator,
    title: "Independent field notes",
    actor: ACTOR
  });
  const notes = captureIds(notesCapture);
  assert.equal(dataOf(notesCapture).observation.observedText, INDEPENDENT_NOTES);

  const surveyClaimBody = "The fictional survey initially favors a weekly product summary.";
  const surveyClaim = await executeOperation(projectRoot, {
    op: "record",
    kb: RESEARCH_KB,
    kind: "claim",
    title: "The survey initially favors a weekly summary",
    body: surveyClaimBody,
    actor: ACTOR
  });
  const surveyClaimId = recordNodeId(surveyClaim, "claim");
  const surveyJustification = await executeOperation(projectRoot, {
    op: "justify",
    kb: RESEARCH_KB,
    conclusion: surveyClaimId,
    groups: [[survey.evidenceId]],
    rationale: "The retained survey observation is the declared basis for this finding.",
    actor: ACTOR
  });
  assert.equal(dataOf(surveyJustification).justification.conclusion, surveyClaimId);
  assert.deepEqual(dataOf(surveyJustification).justification.groups[0].premises, [survey.evidenceId]);

  const notesClaimBody = "Independent notes identify first-run export guidance as a usability concern.";
  const notesClaim = await executeOperation(projectRoot, {
    op: "record",
    kb: RESEARCH_KB,
    kind: "claim",
    title: "Independent notes identify an export guidance concern",
    body: notesClaimBody,
    actor: ACTOR
  });
  const notesClaimId = recordNodeId(notesClaim, "claim");
  const notesJustification = await executeOperation(projectRoot, {
    op: "justify",
    kb: RESEARCH_KB,
    conclusion: notesClaimId,
    groups: [[notes.evidenceId]],
    rationale: "The independent notes are a separate declared basis for this finding.",
    actor: ACTOR
  });
  assert.equal(dataOf(notesJustification).justification.conclusion, notesClaimId);
  assert.deepEqual(dataOf(notesJustification).justification.groups[0].premises, [notes.evidenceId]);

  const questionBody = "The fictional survey does not explain why monthly summaries became more popular in a later sample.";
  const question = await executeOperation(projectRoot, {
    op: "record",
    kb: RESEARCH_KB,
    kind: "question",
    title: "Open question: why did the later preference shift?",
    body: questionBody,
    actor: ACTOR
  });
  const questionId = recordNodeId(question, "question");

  const briefText = `# Fictional product research brief

## Findings

- ${surveyClaimBody}

## Independent context

The separately captured notes support a distinct claim about export guidance;
that claim remains outside this brief's direct basis.

## Open question and limitation

${questionBody}

This brief records the survey claim directly as its knowledge basis. It
remains subject to reassessment when its source support changes.
`;
  await writeFile(join(projectRoot, outputLocator), briefText, "utf8");
  const artifact = await executeOperation(projectRoot, {
    op: "record",
    kb: RESEARCH_KB,
    kind: "artifact",
    title: "Fictional product research brief",
    body: briefText,
    basis: [surveyClaimId],
    fields: {
      locator: outputLocator,
      digest: sha256(briefText)
    },
    links: [{
      to: questionId,
      type: "references",
      rationale: "The brief carries the open question forward as a limitation."
    }],
    actor: ACTOR
  });
  const artifactId = recordNodeId(artifact, "artifact");
  const artifactRevision = artifact.revision;
  assert.deepEqual(dataOf(artifact).justification.groups[0].premises, [surveyClaimId]);
  assert.equal(dataOf(artifact).node.fields.digest, sha256(briefText));

  const historicalBefore = await executeOperation(projectRoot, {
    op: "why",
    nodeId: artifactId,
    kb: RESEARCH_KB,
    revision: artifactRevision,
    evaluationTime: EVALUATION_TIME
  });
  const historicalBeforeData = dataOf(historicalBefore);
  assert.equal(historicalBeforeData.support.status, "usable");
  assert.equal(historicalBeforeData.originalBasis.recordedAtRevision, artifactRevision);
  assert.deepEqual(historicalBeforeData.originalBasis.justification.groups[0].premises, [surveyClaimId]);
  assert.deepEqual(nodeIds(historicalBeforeData.upstream, "historical upstream"), [
    survey.sourceNodeId,
    survey.evidenceId,
    surveyClaimId
  ].sort());
  assert.deepEqual(historicalBeforeData.provenance.map((entry) => entry.sourceId), [survey.sourceId]);

  await writeFile(join(projectRoot, surveyLocator), CHANGED_SURVEY, "utf8");
  const refresh = await executeOperation(projectRoot, {
    op: "refresh",
    kb: RESEARCH_KB,
    sourceIds: [survey.sourceId],
    actor: ACTOR,
    evaluationTime: EVALUATION_TIME
  });
  const refreshData = dataOf(refresh);
  assert.equal(refreshData.changed, true);
  assert.equal(refreshData.sources.length, 1);
  assert.equal(refreshData.sources[0].id, survey.sourceId);
  assert.equal(refreshData.observations.length, 1);
  assert.equal(refreshData.observations[0].sourceId, survey.sourceId);
  assert.equal(refreshData.observations[0].observedText, CHANGED_SURVEY);
  assert.equal(refreshData.changes.length, 1);
  const change = refreshData.changes[0];
  assert.equal(change.sourceId, survey.sourceId);
  assert.equal(change.beforeObservationId, survey.observationId);
  assert.equal(change.reason, "content_changed");
  assert.deepEqual(reviewNodeIds(refreshData.reviews, "refresh reviews"), [survey.evidenceId, surveyClaimId, artifactId].sort());
  assert.equal(refreshData.reviews.every((review) => review.triggerId === change.id && review.status === "open"), true);

  const inspectedSurvey = await executeOperation(projectRoot, {
    op: "inspect_source",
    sourceId: survey.sourceId,
    kb: RESEARCH_KB
  });
  const inspectedSurveyData = dataOf(inspectedSurvey);
  const newObservation = inspectedSurveyData.observations.find((entry) => entry.id !== survey.observationId);
  assert.ok(newObservation, "refresh must retain a new survey observation");
  const newEvidence = inspectedSurveyData.evidence.find((entry) => entry.observationId === newObservation.id);
  assert.ok(newEvidence, "refresh must retain evidence for the new survey observation");

  const impact = await executeOperation(projectRoot, {
    op: "impact",
    nodeId: survey.sourceNodeId,
    kb: RESEARCH_KB,
    evaluationTime: EVALUATION_TIME
  });
  const impactData = dataOf(impact);
  assert.equal(impactData.node.id, survey.sourceNodeId);
  assert.deepEqual(nodeIds(impactData.affected, "survey impact"), [
    survey.evidenceId,
    newEvidence.id,
    surveyClaimId,
    artifactId
  ].sort());
  const expectedImpactPaths = new Map([
    [survey.evidenceId, [[survey.sourceNodeId, survey.evidenceId]]],
    [newEvidence.id, [[survey.sourceNodeId, newEvidence.id]]],
    [surveyClaimId, [[survey.sourceNodeId, survey.evidenceId, surveyClaimId]]],
    [artifactId, [[survey.sourceNodeId, survey.evidenceId, surveyClaimId, artifactId]]]
  ]);
  for (const entry of impactData.affected) {
    assert.deepEqual(entry.paths, expectedImpactPaths.get(entry.node.id));
    assert.ok(entry.reasons.length > 0, `impact reason is required for ${entry.node.id}`);
  }
  assert.deepEqual(impactData.changes.map((entry) => entry.id), [change.id]);
  assert.deepEqual(reviewNodeIds(impactData.reviews, "survey impact reviews"), [survey.evidenceId, surveyClaimId, artifactId].sort());

  const notesImpact = await executeOperation(projectRoot, {
    op: "impact",
    nodeId: notes.sourceNodeId,
    kb: RESEARCH_KB,
    evaluationTime: EVALUATION_TIME
  });
  const notesImpactData = dataOf(notesImpact);
  assert.deepEqual(nodeIds(notesImpactData.affected, "independent notes impact"), [notes.evidenceId, notesClaimId].sort());
  assert.deepEqual(notesImpactData.changes, []);
  assert.deepEqual(notesImpactData.reviews, []);
  assert.equal(notesImpactData.affected.some((entry) => entry.node.id === surveyClaimId), false);
  assert.equal(notesImpactData.affected.some((entry) => entry.node.id === artifactId), false);

  const currentArtifactWhy = await executeOperation(projectRoot, {
    op: "why",
    nodeId: artifactId,
    kb: RESEARCH_KB,
    evaluationTime: EVALUATION_TIME
  });
  const currentArtifactWhyData = dataOf(currentArtifactWhy);
  assert.equal(currentArtifactWhyData.support.status, "pending");
  assert.deepEqual(reviewNodeIds(currentArtifactWhyData.reviews, "current output reviews"), [survey.evidenceId, surveyClaimId, artifactId].sort());
  assert.equal(currentArtifactWhyData.reviews.every((review) => review.status === "open"), true);
  assert.deepEqual(currentArtifactWhyData.changes.map((entry) => entry.id), [change.id]);
  assert.deepEqual(currentArtifactWhyData.provenance.map((entry) => entry.sourceId), [survey.sourceId]);
  assert.equal(currentArtifactWhyData.provenance.find((entry) => entry.sourceId === survey.sourceId).observedText, INITIAL_SURVEY);

  const notesClaimWhy = await executeOperation(projectRoot, {
    op: "why",
    nodeId: notesClaimId,
    kb: RESEARCH_KB,
    evaluationTime: EVALUATION_TIME
  });
  assert.equal(dataOf(notesClaimWhy).support.status, "usable");

  const historicalAfter = await executeOperation(projectRoot, {
    op: "why",
    nodeId: artifactId,
    kb: RESEARCH_KB,
    revision: artifactRevision,
    evaluationTime: EVALUATION_TIME
  });
  assert.deepEqual(historicalAfter.data, historicalBefore.data);

  const reviewQuery = await executeOperation(projectRoot, { op: "review", kb: RESEARCH_KB });
  const reviewData = dataOf(reviewQuery);
  assert.deepEqual(reviewNodeIds(reviewData.reviews, "review query"), [survey.evidenceId, surveyClaimId, artifactId].sort());
  assert.equal(reviewData.reviews.every((review) => review.triggerId === change.id && review.status === "open"), true);

  console.log(JSON.stringify({
    ok: true,
    projectRoot,
    knowledgeBase: RESEARCH_KB,
    output: {
      artifactId,
      locator: outputLocator,
      basis: [surveyClaimId],
      statusAfterSurveyChange: "pending_reassessment",
      openQuestionId: questionId
    },
    sources: {
      survey: { sourceId: survey.sourceId, sourceNodeId: survey.sourceNodeId, evidenceId: survey.evidenceId, newEvidenceId: newEvidence.id },
      independentNotes: { sourceId: notes.sourceId, sourceNodeId: notes.sourceNodeId, evidenceId: notes.evidenceId }
    },
    affectedAfterSurveyChange: [survey.evidenceId, surveyClaimId, artifactId],
    unaffectedIndependentNotes: [notes.evidenceId, notesClaimId],
    changedRevision: refresh.revision,
    historicalWhyRevision: artifactRevision
  }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
});
