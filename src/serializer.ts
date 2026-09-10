import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { JUSTIFICATION_PROFILE, canonicalJson, sha256 } from "./domain.ts";
import type { NodeRecord, ProjectState } from "./domain.ts";

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

const MANIFEST_PATH = [".justification", "projection-manifest.json"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function yamlFrontmatter(node: NodeRecord, state: ProjectState, generatedAt: string): string {
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
  const extension: Record<string, unknown> = {
    profile: JUSTIFICATION_PROFILE,
    id: node.id,
    kb: node.kb,
    kind: node.kind,
    created_by: node.createdBy,
    created_at: node.createdAt,
    ...(node.applicability ? { applicability: node.applicability } : {}),
    ...(node.fields ? { fields: node.fields } : {})
  };
  return stringifyYaml({
    type: node.kind,
    generated: { by: "justification/0.1.0", at: generatedAt },
    status: "stable",
    ...(sources.length > 0 ? { sources } : {}),
    justification: extension
  }).trimEnd();
}

function bodyFor(node: NodeRecord, state: ProjectState): string {
  const lines = [node.body.trimEnd()];
  lines.push("", `<!-- justification:id=${node.id} kb=${node.kb} -->`);
  if (node.fields?.sourceId) {
    const source = state.sources[node.fields.sourceId];
    if (source) lines.push(`Source: [${source.locator}](../${source.locator})`);
  }
  if (node.fields?.observationId) lines.push(`Retained observation: ${node.fields.observationId}`);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function projectDocuments(state: ProjectState, generatedAt = new Date().toISOString(), kbFilter?: string): ProjectionDocument[] {
  const nodes = Object.values(state.nodes)
    .filter((node) => kbFilter === undefined || node.kb === kbFilter || node.kb === "shared")
    .sort((a, b) => a.id.localeCompare(b.id));
  const documents: ProjectionDocument[] = nodes.map((node) => ({
    relativePath: join("kb", node.kb, `${node.id}.md`),
    content: `---\n${yamlFrontmatter(node, state, generatedAt)}\n---\n\n${bodyFor(node, state)}`
  }));
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

async function detectDrift(root: string, manifest: Record<string, string>): Promise<void> {
  for (const [path, expected] of Object.entries(manifest)) {
    try {
      const info = await lstat(join(root, path));
      if (info.isSymbolicLink() || !info.isFile()) throw new ProjectionError(`generated projection is not a regular file: ${path}`);
      const actual = sha256(await readFile(join(root, path)));
      if (actual !== expected) throw new ProjectionError(`generated projection was modified: ${path}`);
    } catch (error) {
      if (error instanceof ProjectionError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ProjectionError(`generated projection is missing: ${path}`);
      throw error;
    }
  }
}

async function preflightTargets(root: string, documents: readonly ProjectionDocument[], previous: Record<string, string> | undefined): Promise<void> {
  for (const document of documents) {
    const path = document.relativePath.replaceAll("\\", "/");
    const absolute = join(root, document.relativePath);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || !info.isFile()) throw new ProjectionError(`projection destination is not a regular file: ${path}`);
      if (!previous || previous[path] === undefined) throw new ProjectionError(`projection destination is already owned outside the generated manifest: ${path}`);
    } catch (error) {
      if (error instanceof ProjectionError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ProjectionError(`cannot inspect projection destination: ${path}`, { cause: error });
    }
  }
}

export async function writeProjection(root: string, state: ProjectState, options: { readonly kb?: string; readonly repair?: boolean; readonly generatedAt?: string } = {}): Promise<ProjectionResult> {
  await ensureProjectionRoots(root);
  const previous = await readManifest(root);
  if (previous && !options.repair) await detectDrift(root, previous);
  const documents = projectDocuments(state, options.generatedAt, options.kb);
  await preflightTargets(root, documents, previous);
  const files: Record<string, string> = {};
  for (const document of documents) {
    const absolute = join(root, document.relativePath);
    const rootRelative = relative(root, absolute);
    if (rootRelative.startsWith(`..${sep}`)) throw new ProjectionError(`projection path escapes project root: ${document.relativePath}`);
    await ensureSafeDirectory(join(root, dirnameFromRelative(document.relativePath)));
    const temporary = `${absolute}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temporary, document.content, "utf8");
    await rename(temporary, absolute);
    files[document.relativePath.replaceAll("\\", "/")] = sha256(document.content);
  }
  const manifest = { format: "justification.projection", version: 1, files };
  const manifestAbsolute = join(root, ...MANIFEST_PATH);
  const temporaryManifest = `${manifestAbsolute}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryManifest, manifestAbsolute);
  return { files: Object.keys(files).sort(), manifestDigest: sha256(canonicalJson(manifest)) };
}

function dirnameFromRelative(path: string): string {
  const parts = path.split(/[\\/]/g);
  return parts.slice(0, -1).join(sep) || ".";
}
