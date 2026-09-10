import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { JUSTIFICATION_PROFILE, ProjectState, canonicalJson, sha256 } from "./domain.ts";
import type { NodeRecord } from "./domain.ts";
import { RuntimeError } from "./runtime.ts";

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
    if (source) sources.push({ id: source.id, resource: `file://${source.locator}` });
  }
  const sourceLocator = node.fields?.locator;
  if (typeof sourceLocator === "string" && sourceLocator.length > 0 && sources.length === 0) {
    sources.push({ resource: `file://${sourceLocator}` });
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
    if (source) lines.push(`Source: [${source.locator}](file://${source.locator})`);
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
    content: `---\n${yamlFrontmatter(node, state, generatedAt)}---\n\n${bodyFor(node, state)}`
  }));
  const kbIds = Object.values(state.kbs)
    .filter((kb) => kbFilter === undefined || kb.id === kbFilter || kb.id === "shared")
    .map((kb) => kb.id)
    .sort();
  for (const id of kbIds) {
    documents.push({
      relativePath: join("kb", id, "index.md"),
      content: `---\n${stringifyYaml({ type: "knowledge_base", generated: { by: "justification/0.1.0", at: generatedAt }, status: "stable", justification: { profile: JUSTIFICATION_PROFILE, kb: id, title: state.kbs[id]?.title } }).trimEnd()}---\n\n# ${state.kbs[id]?.title ?? id}\n\nThis document is a generated Justification projection.\n`
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
    if (info.isSymbolicLink() || !info.isDirectory()) throw new RuntimeError("PROJECTION_DRIFT", `managed projection path is not a directory: ${path}`);
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
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
    const parsed: unknown = JSON.parse(await readFile(join(root, ...MANIFEST_PATH), "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.files)) throw new RuntimeError("PROJECTION_DRIFT", "projection manifest is malformed");
    const files: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.files)) {
      if (typeof value !== "string") throw new RuntimeError("PROJECTION_DRIFT", "projection manifest contains an invalid digest");
      files[key] = value;
    }
    return files;
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new RuntimeError("PROJECTION_DRIFT", "cannot read projection manifest", undefined, { cause: error });
  }
}

async function detectDrift(root: string, manifest: Record<string, string>): Promise<void> {
  for (const [path, expected] of Object.entries(manifest)) {
    try {
      const actual = sha256(await readFile(join(root, path)));
      if (actual !== expected) throw new RuntimeError("PROJECTION_DRIFT", `generated projection was modified: ${path}`, { path });
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new RuntimeError("PROJECTION_DRIFT", `generated projection is missing: ${path}`, { path });
      throw error;
    }
  }
}

export async function writeProjection(root: string, state: ProjectState, options: { readonly kb?: string; readonly repair?: boolean; readonly generatedAt?: string } = {}): Promise<ProjectionResult> {
  await ensureProjectionRoots(root);
  const previous = await readManifest(root);
  if (previous && !options.repair) await detectDrift(root, previous);
  const documents = projectDocuments(state, options.generatedAt, options.kb);
  const files: Record<string, string> = {};
  for (const document of documents) {
    const absolute = join(root, document.relativePath);
    const rootRelative = relative(root, absolute);
    if (rootRelative.startsWith(`..${sep}`)) throw new RuntimeError("PROJECTION_DRIFT", `projection path escapes project root: ${document.relativePath}`);
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

