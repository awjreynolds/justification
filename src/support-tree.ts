import type {
  JustificationRecord,
  NodeRecord,
  ProjectState,
  SourceObservation,
  SourceRecord,
} from "./domain.ts";

/**
 * The semantic support graph used by both runtime explanations and rendered
 * projections. A premise may omit `tree` when it was already visited; the ID
 * remains present in its group while the shared traversal prevents duplicate
 * expansion and terminates on malformed cycles.
 */
export type SupportTree = {
  readonly node: NodeRecord;
  readonly justifications: readonly SupportTreeJustification[];
  readonly source?: SourceRecord;
  readonly observation?: SourceObservation;
  readonly sourceNode?: NodeRecord;
};

export type SupportTreeJustification = {
  readonly justification: JustificationRecord;
  readonly groups: readonly SupportTreeGroup[];
};

export type SupportTreeGroup = {
  readonly group: JustificationRecord["groups"][number];
  readonly premises: readonly SupportTreePremise[];
};

export type SupportTreePremise = {
  readonly id: string;
  readonly tree?: SupportTree;
};

export type SupportProvenance = {
  readonly source: SourceRecord;
  readonly observation: SourceObservation;
};

function sourceDetails(state: ProjectState, node: NodeRecord): Pick<SupportTree, "source" | "observation" | "sourceNode"> {
  if (node.kind !== "evidence" || typeof node.fields?.sourceId !== "string") return {};
  const source = state.sources[node.fields.sourceId];
  if (source === undefined) return {};
  const observationId = node.fields.observationId;
  const observation = typeof observationId === "string" ? state.observations[observationId] : undefined;
  return {
    source,
    observation,
    sourceNode: state.nodes[source.nodeId],
  };
}

function orderedJustifications(state: ProjectState, nodeId: string): readonly JustificationRecord[] {
  const node = state.nodes[nodeId];
  return Object.values(state.justifications)
    .filter((justification) => justification.conclusion === nodeId && node !== undefined && justification.kb === node.kb)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Build one deterministic, cycle-safe semantic support representation. */
export function buildSupportTree(state: ProjectState, rootId: string): SupportTree {
  const seen = new Set<string>();
  const visit = (nodeId: string): SupportTree | undefined => {
    if (seen.has(nodeId)) return undefined;
    const node = state.nodes[nodeId];
    if (node === undefined) return undefined;
    seen.add(nodeId);
    const justifications = orderedJustifications(state, nodeId).map((justification) => ({
      justification,
      groups: justification.groups.map((group) => ({
        group,
        premises: group.premises.map((id) => ({ id, tree: visit(id) }))
      }))
    }));
    return {
      node,
      justifications,
      ...sourceDetails(state, node)
    };
  };
  const root = visit(rootId);
  if (root === undefined) throw new Error(`support root not found: ${rootId}`);
  return root;
}

/** Return the exact transitive support node IDs, excluding the root itself. */
export function supportNodeIds(tree: SupportTree): string[] {
  const result = new Set<string>();
  const visit = (current: SupportTree, includeNode: boolean): void => {
    if (includeNode) result.add(current.node.id);
    if (current.sourceNode !== undefined) result.add(current.sourceNode.id);
    for (const justification of current.justifications) {
      for (const group of justification.groups) {
        for (const premise of group.premises) {
          if (premise.tree !== undefined) visit(premise.tree, true);
        }
      }
    }
  };
  visit(tree, false);
  return [...result].sort((a, b) => a.localeCompare(b));
}

/** Return the unique retained observations reachable through support. */
export function supportProvenance(tree: SupportTree): SupportProvenance[] {
  const result = new Map<string, SupportProvenance>();
  const visit = (current: SupportTree): void => {
    if (current.node.kind === "evidence" && current.source !== undefined && current.observation !== undefined) {
      result.set(current.observation.id, { source: current.source, observation: current.observation });
    }
    for (const justification of current.justifications) {
      for (const group of justification.groups) {
        for (const premise of group.premises) {
          if (premise.tree !== undefined) visit(premise.tree);
        }
      }
    }
  };
  visit(tree);
  return [...result.values()].sort((a, b) => a.observation.id.localeCompare(b.observation.id));
}
