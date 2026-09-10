import type { ProjectState, ReviewRecord } from "./domain.ts";

/** Resolve the scope that owns a review, even after its affected node moves. */
export function reviewOwnerKb(state: ProjectState, review: ReviewRecord): string | undefined {
  if (review.kb !== undefined) return review.kb;
  if (review.triggerType === "contradiction") {
    const contradiction = state.contradictions.find((candidate) => candidate.id === review.triggerId);
    if (contradiction !== undefined) return contradiction.kb;
  }
  return state.nodes[review.nodeId]?.kb;
}

export function reviewVisibleInKb(state: ProjectState, review: ReviewRecord, kb?: string): boolean {
  const owner = reviewOwnerKb(state, review);
  return owner !== undefined && (kb === undefined || owner === "shared" || owner === kb);
}
