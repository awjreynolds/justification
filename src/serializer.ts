import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { JUSTIFICATION_PROFILE, canonicalJson, sha256 } from "./domain.ts";
import type { NodeRecord, ProjectState } from "./domain.ts";
import { withProjectLock } from "./storage.ts";
import { buildSupportTree } from "./support-tree.ts";
import { supportProvenance } from "./support-tree.ts";
import type { SupportTree } from "./support-tree.ts";

export class ProjectionError extends Error {
  readonly name = "ProjectionError";
  readonly code = "PROJECTION_DRIFT" as const;
}

export type ProjectionDocument = {
  readonly relativePath: string;
  readonly content: string;
};

export type ProjectionResult = {
  readonly files: readonly string[];
  readonly manifestDigest: string;
};

export type ProjectionWriteOptions = {
  readonly kb?: string;
  readonly repair?: boolean;
  readonly allowMissing?: boolean;
  readonly generatedAt?: string;
};

const MANIFEST_PATH = [".justification", "projection-manifest.json"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeLink(from: NodeRecord, target: NodeRecord): string {
  const fromDirectory = join("kb", from.kb);
  const targetPath = join("kb", target.kb, `${target.id}.md`);
  const href = relative(fromDirectory, targetPath).replaceAll(sep, "/");
  return `[${target.id}](${href})`;
}

function justificationExtension(state: ProjectState, node: NodeRecord, supportTree: SupportTree): Record<string, unknown> {
  const justifications = Object.values(state.justifications)
    .filter((justification) => justification.conclusion === node.id && justification.kb === node.kb)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((justification) => ({
      id: justification.id,
      kb: justification.kb,
      conclusion: justification.conclusion,
      groups: justification.groups.map((group) => ({ id: group.id, premises: [...group.premises] })),
      rationale: justification.rationale,
      ...(justification.title === undefined ? {} : { title: justification.title }),
      ...(justification.applicability === undefined ? {} : { applicability: justification.applicability }),
      createdBy: justification.createdBy,
      createdAt: justification.createdAt
    }));
  const relationships = Object.values(state.relationships)
    .filter((relationship) => relationship.kb === node.kb && (relationship.from === node.id || relationship.to === node.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((relationship) => ({ ...relationship }));
  const provenance = supportProvenance(supportTree).map(({ source, observation }) => ({
    sourceId: source.id,
    observationId: observation.id,
    providerId: observation.providerId,
    locator: observation.locator,
    ...(observation.providerRevision === undefined ? {} : { providerRevision: observation.providerRevision }),
    ...(observation.digest === undefined ? {} : { digest: observation.digest }),
    ...(observation.observedBytesDigest === undefined ? {} : { observedBytesDigest: observation.observedBytesDigest }),
    ...(observation.observedText === undefined ? {} : { observedText: observation.observedText }),
    availability: observation.availability
  }));
  return {
    profile: JUSTIFICATION_PROFILE,
    id: node.id,
    kb: node.kb,
    kind: node.kind,
    created_by: node.createdBy,
    created_at: node.createdAt,
    ...(node.applicability ? { applicability: node.applicability } : {}),
    ...(node.fields ? { fields: node.fields } : {}),
    ...(justifications.length > 0 ? { justifications } : {}),
    ...(relationships.length > 0 ? { relationships } : {}),
    ...(provenance.length > 0 ? { provenance } : {})
  };
}

function yamlFrontmatter(node: NodeRecord, state: ProjectState, generatedAt: string, supportTree: SupportTree): string {
  const sources: Array<Record<string, string>> = [];
  const sourceId = node.fields?.sourceId;
  if (typeof sourceId === "string") {
    const source = state.sources[sourceId];
    if (source) sources.push({ id: source.id, resource: source.locator });
  }
  const sourceLocator = node.fields?.locator;
  if (typeof sourceLocator === "string" && sourceLocator.length > 0 && sources.length === 0) {
    sources.push({ resource: sourceLocator });
  }
  const extension = justificationExtension(state, node, supportTree);
  return stringifyYaml({
    type: node.kind,
    generated: { by: "justification/0.1.0", at: generatedAt },
    status: "stable",
    ...(sources.length > 0 ? { sources } : {}),
    justification: extension
  }).trimEnd();
}

function bodyFor(node: NodeRecord, state: ProjectState, supportTree: SupportTree): string {
  const lines = [node.body.trimEnd()];
  lines.push("", `<!-- justification:id=${node.id} kb=${node.kb} -->`);
  if (node.fields?.sourceId) {
    const source = state.sources[node.fields.sourceId];
    if (source) {
      const href = relative(join("kb", node.kb), source.locator).replaceAll(sep, "/");
      lines.push(`Source: [${source.locator}](${href})`);
    }
  }
  if (node.fields?.observationId) lines.push(`Retained observation: ${node.fields.observationId}`);
  const reasoning = reasoningFor(node, state, supportTree);
  if (reasoning.length > 0) lines.push("", "## Justification", ...reasoning);
  return `${lines.join("\n").trimEnd()}\n`;
}

function reasoningFor(node: NodeRecord, state: ProjectState, supportTree: SupportTree): string[] {
  const lines: string[] = [];
  const visit = (tree: SupportTree, depth: number): void => {
    const candidate = tree.node;
    const prefix = "  ".repeat(Math.min(depth, 8));
    lines.push(`${prefix}- ${candidate.kind} ${nodeLink(node, candidate)}: ${candidate.title}`);
    for (const { justification, groups } of tree.justifications) {
      lines.push(`${prefix}  Basis ${justification.id}: ${justification.rationale}`);
      for (const { group, premises } of groups) {
        const premiseLinks = premises.map((premise) => {
          const target = premise.tree?.node ?? state.nodes[premise.id];
          return target === undefined ? premise.id : nodeLink(node, target);
        });
        lines.push(`${prefix}  Premises: ${premiseLinks.join(", ")}`);
        for (const premise of premises) {
          if (premise.tree !== undefined) visit(premise.tree, depth + 1);
        }
      }
    }
    if (candidate.kind === "evidence") {
      if (tree.source !== undefined) lines.push(`${prefix}  Source ${tree.source.id}: ${tree.source.locator}`);
      if (tree.observation !== undefined) {
        const observation = tree.observation;
        lines.push(`${prefix}  Observation ${observation.id}: ${observation.providerRevision ?? "unknown revision"}`);
        if (observation.observedText !== undefined) lines.push(`${prefix}  Observed text: ${observation.observedText.trimEnd()}`);
      }
    }
  };
  visit(supportTree, 0);
  return lines;
}

export function projectDocuments(state: ProjectState, generatedAt = new Date().toISOString(), kbFilter?: string): ProjectionDocument[] {
  const nodes = Object.values(state.nodes)
    .filter((node) => kbFilter === undefined || node.kb === kbFilter || node.kb === "shared")
    .sort((a, b) => a.id.localeCompare(b.id));
  const documents: ProjectionDocument[] = nodes.map((node) => {
    const supportTree = buildSupportTree(state, node.id);
    return {
      relativePath: join("kb", node.kb, `${node.id}.md`),
      content: `---\n${yamlFrontmatter(node, state, generatedAt, supportTree)}\n---\n\n${bodyFor(node, state, supportTree)}`
    };
  });
  const kbIds = Object.values(state.kbs)
    .filter((kb) => kbFilter === undefined || kb.id === kbFilter || kb.id === "shared")
    .map((kb) => kb.id)
    .sort();
  for (const id of kbIds) {
    documents.push({
      relativePath: join("kb", id, "index.md"),
      content: `# ${state.kbs[id]?.title ?? id}\n\nThis document is a generated Justification projection for knowledge base \`${id}\`.\n`
    });
  }
  documents.push({
    relativePath: "kb/index.md",
    content: `---\nokf_version: '0.2'\n---\n\n# ${state.projectName}\n\nGenerated Justification knowledge bundle.\n`
  });
  return documents.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function ensureSafeDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new ProjectionError(`managed projection path is not a directory: ${path}`);
  } catch (error) {
    if (error instanceof ProjectionError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path);
  }
}

async function ensureProjectionRoots(root: string): Promise<void> {
  await ensureSafeDirectory(join(root, "kb"));
  await ensureSafeDirectory(join(root, ".justification"));
}

async function readManifest(root: string): Promise<Record<string, string> | undefined> {
  try {
    const manifestPath = join(root, ...MANIFEST_PATH);
    const info = await lstat(manifestPath);
    if (info.isSymbolicLink() || !info.isFile()) throw new ProjectionError("projection manifest must be a regular file");
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.files)) throw new ProjectionError("projection manifest is malformed");
    const files: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.files)) {
      if (typeof value !== "string") throw new ProjectionError("projection manifest contains an invalid digest");
      files[key] = value;
    }
    return files;
  } catch (error) {
    if (error instanceof ProjectionError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ProjectionError("cannot read projection manifest", { cause: error });
  }
}

async function detectDrift(root: string, expectedFiles: Record<string, string>, allowMissing: boolean): Promise<void> {
  for (const [path, expected] of Object.entries(expectedFiles)) {
    try {
      const info = await lstat(join(root, path));
      if (info.isSymbolicLink() || !info.isFile()) throw new ProjectionError(`generated projection is not a regular file: ${path}`);
      const actual = sha256(await readFile(join(root, path)));
      if (actual !== expected) throw new ProjectionError(`generated projection was modified: ${path}`);
    } catch (error) {
      if (error instanceof ProjectionError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) continue;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ProjectionError(`generated projection is missing: ${path}`);
      throw error;
    }
  }
}

async function preflightTargets(
  root: string,
  documents: readonly ProjectionDocument[],
  expectedFiles: Record<string, string>,
  repair: boolean
): Promise<void> {
  for (const document of documents) {
    const path = document.relativePath.replaceAll("\\", "/");
    const absolute = join(root, document.relativePath);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || !info.isFile()) throw new ProjectionError(`projection destination is not a regular file: ${path}`);
      if (repair) continue;
      const expected = expectedFiles[path];
      if (expected === undefined) throw new ProjectionError(`projection destination is not a known generated path: ${path}`);
      const actual = sha256(await readFile(absolute));
      if (actual !== expected) throw new ProjectionError(`generated projection was modified: ${path}`);
    } catch (error) {
      if (error instanceof ProjectionError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ProjectionError(`cannot inspect projection destination: ${path}`, { cause: error });
    }
  }
}

export async function writeProjection(root: string, state: ProjectState, options: ProjectionWriteOptions = {}): Promise<ProjectionResult> {
  return withProjectLock(root, async () => {
    await ensureProjectionRoots(root);
    const previous = await readManifest(root);
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const allDocuments = projectDocuments(state, generatedAt);
    const documents = options.kb === undefined ? allDocuments : projectDocuments(state, generatedAt, options.kb);
    const currentOwnership: Record<string, string> = {};
    for (const document of allDocuments) currentOwnership[document.relativePath.replaceAll("\\", "/")] = sha256(document.content);

    // Manifest entries are disposable and untrusted. Preserve only paths that
    // are independently derivable from the validated semantic state. When the
    // manifest is missing, current revision state plus its committed timestamp
    // provides the historical generated bytes used for ownership checks.
    const ownedPrevious: Record<string, string> = {};
    if (previous !== undefined) {
      for (const [path, digest] of Object.entries(previous)) {
        if (Object.prototype.hasOwnProperty.call(currentOwnership, path)) ownedPrevious[path] = digest;
      }
    }
    if (previous && !options.repair) await detectDrift(root, ownedPrevious, options.allowMissing === true);
    const expectedTargets: Record<string, string> = {};
    for (const document of documents) {
      const path = document.relativePath.replaceAll("\\", "/");
      expectedTargets[path] = ownedPrevious[path] ?? currentOwnership[path] ?? sha256(document.content);
    }
    await preflightTargets(root, documents, expectedTargets, options.repair === true);
    const files: Record<string, string> = { ...ownedPrevious };
    const writtenFiles: string[] = [];
    for (const document of documents) {
      const absolute = join(root, document.relativePath);
      const rootRelative = relative(root, absolute);
      if (rootRelative.startsWith(`..${sep}`)) throw new ProjectionError(`projection path escapes project root: ${document.relativePath}`);
      await ensureSafeDirectory(join(root, dirnameFromRelative(document.relativePath)));
      const temporary = `${absolute}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(temporary, document.content, "utf8");
      await rename(temporary, absolute);
      const path = document.relativePath.replaceAll("\\", "/");
      files[path] = sha256(document.content);
      writtenFiles.push(path);
    }
    const manifest = { format: "justification.projection", version: 1, files };
    const manifestAbsolute = join(root, ...MANIFEST_PATH);
    const temporaryManifest = `${manifestAbsolute}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporaryManifest, manifestAbsolute);
    return { files: writtenFiles.sort(), manifestDigest: sha256(canonicalJson(manifest)) };
  });
}

function dirnameFromRelative(path: string): string {
  const parts = path.split(/[\\/]/g);
  return parts.slice(0, -1).join(sep) || ".";
}
