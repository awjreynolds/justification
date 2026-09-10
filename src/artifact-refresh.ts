import type {
  ArtifactDriftRecord,
  ArtifactFileState,
  NodeRecord
} from "./domain.ts";
import { FileKnowledgeProvider, ProviderError } from "./provider.ts";
import type { ProviderFetch } from "./provider.ts";

export type ArtifactDriftPlan = {
  readonly artifactId: string;
  readonly locator: string;
  readonly before: ArtifactFileState;
  readonly after: ArtifactFileState;
  readonly reason: "content_changed" | "availability_changed";
  readonly requiresReview: boolean;
};

function deniedCause(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { readonly code?: unknown }).code;
    if (code === "EACCES" || code === "EPERM") return true;
    current = (current as { readonly cause?: unknown }).cause;
  }
  return false;
}

function providerFailure(locator: string, error: unknown): ProviderFetch | undefined {
  if (!(error instanceof ProviderError) || error.code !== "PROVIDER_UNAVAILABLE") return undefined;
  return {
    status: deniedCause(error) ? "denied" : "unavailable",
    locator,
    diagnostics: error.message
  };
}

async function fetchArtifact(provider: FileKnowledgeProvider, locator: string): Promise<ProviderFetch> {
  try {
    const resolved = await provider.resolve(locator);
    return await provider.fetch(resolved);
  } catch (error) {
    const failure = providerFailure(locator, error);
    if (failure !== undefined) return failure;
    throw error;
  }
}

function fileState(fetch: ProviderFetch): ArtifactFileState {
  return {
    status: fetch.status,
    ...(fetch.digest === undefined ? {} : { digest: fetch.digest }),
    ...(fetch.bytesDigest === undefined ? {} : { bytesDigest: fetch.bytesDigest }),
    ...(fetch.diagnostics === undefined ? {} : { diagnostics: fetch.diagnostics })
  };
}

/** Compare provider states while ignoring diagnostics that may vary between checks. */
export function sameArtifactState(left: ArtifactFileState, right: ArtifactFileState): boolean {
  if (left.status !== right.status) return false;
  if (left.status !== "present") return true;
  if (left.digest !== right.digest) return false;
  return left.bytesDigest === undefined || right.bytesDigest === undefined || left.bytesDigest === right.bytesDigest;
}

function acceptedState(node: NodeRecord): ArtifactFileState | undefined {
  const digest = node.fields?.digest;
  if (typeof digest !== "string" || digest.length === 0) return undefined;
  const bytesDigest = node.fields?.observedBytesDigest;
  return {
    status: "present",
    digest,
    ...(typeof bytesDigest === "string" ? { bytesDigest } : {})
  };
}

function latestDrift(drifts: readonly ArtifactDriftRecord[], artifactId: string): ArtifactDriftRecord | undefined {
  for (let index = drifts.length - 1; index >= 0; index -= 1) {
    if (drifts[index]?.artifactId === artifactId) return drifts[index];
  }
  return undefined;
}

function driftReason(before: ArtifactFileState, after: ArtifactFileState): "content_changed" | "availability_changed" {
  return before.status === "present" && after.status === "present" ? "content_changed" : "availability_changed";
}

/** Probe accepted artifact files and return each newly observed durable state. */
export async function planArtifactDrifts(
  root: string,
  artifacts: readonly NodeRecord[],
  previousDrifts: readonly ArtifactDriftRecord[] = []
): Promise<ArtifactDriftPlan[]> {
  const provider = new FileKnowledgeProvider(root);
  const plans: ArtifactDriftPlan[] = [];
  for (const artifact of artifacts) {
    const locator = artifact.fields?.locator;
    const accepted = acceptedState(artifact);
    if (typeof locator !== "string" || locator.trim().length === 0 || accepted === undefined) continue;

    const observed = fileState(await fetchArtifact(provider, locator));
    const previous = latestDrift(previousDrifts, artifact.id);
    const before = previous?.after ?? accepted;
    if (sameArtifactState(before, observed)) continue;

    plans.push({
      artifactId: artifact.id,
      locator,
      before,
      after: observed,
      reason: driftReason(before, observed),
      requiresReview: !sameArtifactState(accepted, observed)
    });
  }
  return plans;
}
