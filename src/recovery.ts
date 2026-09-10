import { lstat, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256 } from "./domain.ts";
import type { HistoryRevision } from "./domain.ts";
import { ProjectionError, writeProjection } from "./serializer.ts";
import { readHistory, withProjectLock } from "./storage.ts";

export type RebuildRequest = {
  readonly op: "rebuild";
  readonly actor?: string;
  readonly at?: string;
  readonly expectedRevision?: number;
};

export type RebuildResponse = {
  readonly revision: number;
  readonly data: {
    readonly rebuilt: true;
    readonly committed: false;
    readonly revision: number;
    readonly index: {
      readonly path: ".justification/index.json";
      readonly digest: string;
    };
    readonly projection: {
      readonly files: readonly string[];
      readonly manifestDigest: string;
    };
  };
};

class RebuildConflictError extends Error {
  readonly code = "CONFLICT" as const;
  readonly details: { readonly expectedRevision: number; readonly currentRevision: number };

  constructor(expectedRevision: number, currentRevision: number) {
    super(`expected revision ${expectedRevision} but current revision is ${currentRevision}`);
    this.name = "RebuildConflictError";
    this.details = { expectedRevision, currentRevision };
  }
}

type DisposableIndex = {
  readonly format: "justification.index";
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly historyDigest: string;
  readonly generatedAt: string;
  readonly knowledgeBases: readonly string[];
  readonly nodes: readonly string[];
  readonly sources: readonly string[];
  readonly observations: readonly string[];
  readonly justifications: readonly string[];
  readonly relationships: readonly string[];
  readonly changes: readonly string[];
  readonly contradictions: readonly string[];
  readonly reviews: readonly string[];
  readonly scopeChanges: readonly string[];
};

function sortedKeys(value: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(value).sort();
}

function disposableIndex(revision: HistoryRevision): DisposableIndex {
  const state = revision.state;
  return {
    format: "justification.index",
    version: 1,
    projectId: state.projectId,
    revision: revision.revision,
    historyDigest: revision.integrity,
    generatedAt: revision.committedAt,
    knowledgeBases: sortedKeys(state.kbs),
    nodes: sortedKeys(state.nodes),
    sources: sortedKeys(state.sources),
    observations: sortedKeys(state.observations),
    justifications: sortedKeys(state.justifications),
    relationships: sortedKeys(state.relationships),
    changes: [...state.changes].map((change) => change.id).sort(),
    contradictions: [...state.contradictions].map((contradiction) => contradiction.id).sort(),
    reviews: [...state.reviews].map((review) => review.id).sort(),
    scopeChanges: [...state.scopeChanges].map((change) => change.id).sort()
  };
}

async function writeDisposableIndex(root: string, index: DisposableIndex): Promise<{ readonly path: ".justification/index.json"; readonly digest: string }> {
  const path = join(root, ".justification", "index.json");
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new ProjectionError("disposable index must be a regular file");
  } catch (error) {
    if (error instanceof ProjectionError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ProjectionError("cannot inspect disposable index", { cause: error });
  }
  const content = `${JSON.stringify(index, null, 2)}\n`;
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
  return { path: ".justification/index.json", digest: sha256(canonicalJson(index)) };
}

/** Rebuild only disposable state from the currently validated durable revision. */
export async function handleRebuild(root: string, request: RebuildRequest): Promise<RebuildResponse> {
  return withProjectLock(root, async () => {
    const loaded = await readHistory(root);
    const current = loaded.revision;
    if (request.expectedRevision !== undefined && request.expectedRevision !== current.revision) {
      throw new RebuildConflictError(request.expectedRevision, current.revision);
    }
    const index = disposableIndex(current);
    const projection = await writeProjection(root, current.state, {
      generatedAt: current.committedAt,
      allowMissing: true,
      ignoreInvalidManifest: true
    });
    const disposable = await writeDisposableIndex(root, index);
    return {
      revision: current.revision,
      data: {
        rebuilt: true,
        committed: false,
        revision: current.revision,
        index: disposable,
        projection: {
          files: projection.files,
          manifestDigest: projection.manifestDigest
        }
      }
    };
  });
}
