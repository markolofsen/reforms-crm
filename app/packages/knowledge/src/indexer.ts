import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Repos } from "@hub/db";
import { projectStore } from "@hub/projects/store";
import { canonicalBrands, entryBrandProblem } from "@hub/projects/brands";
import type { ProjectConfig } from "@hub/projects/model";
import { EntryError, parseEntry, sha256, type Entry } from "./entry";
import { checkAgainstTaxonomy, loadTaxonomy, TAXONOMY_FILE, TaxonomyError, type Taxonomy } from "./taxonomy";

export interface IndexResult {
  /** Entry files found under knowledge/. */
  files: number;
  added: number;
  updated: number;
  unchanged: number;
  /** Rows removed because their file is gone (or no longer valid). */
  deleted: number;
  /** Files that could not be parsed; they are not indexed. */
  invalid: Array<{ path: string; error: string }>;
  /** Advisory taxonomy findings (category, stages, kind outside knowledge/taxonomy.md); the entries are indexed. */
  warnings: Array<{ path: string; message: string }>;
}

/** Every `.md` under `dir`, as paths relative to `base`, with `/` separators, sorted. */
export function walkMarkdown(dir: string, base: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkMarkdown(p, base));
    else if (name.endsWith(".md")) {
      const rel = relative(base, p).split(sep).join("/");
      if (rel !== TAXONOMY_FILE) out.push(rel); // the taxonomy is data about entries, not an entry
    }
  }
  return out;
}

/** One entry file the indexer would store: its path, the file's hash, the parsed entry and its canonical brands. */
export interface PlannedEntry {
  path: string;
  hash: string;
  entry: Entry;
  brands: string[];
}

/**
 * What the indexer reads from `<root>/<slug>/knowledge/**.md` (P140 K1: one reading for the indexer and the drift check):
 * the entries it stores, the files it refuses (`invalid`) and the advisory taxonomy findings.
 */
export function planProject(root: string, slug: string): { files: number; entries: PlannedEntry[]; invalid: IndexResult["invalid"]; warnings: IndexResult["warnings"] } {
  const folder = join(root, slug);
  if (!existsSync(folder)) throw new Error(`no such project folder: ${folder}`);
  const files = walkMarkdown(join(folder, "knowledge"), folder);
  const invalid: IndexResult["invalid"] = [];
  const warnings: IndexResult["warnings"] = [];
  let taxonomy: Taxonomy | null = null;
  try {
    taxonomy = loadTaxonomy(folder);
  } catch (err) {
    if (!(err instanceof TaxonomyError)) throw err;
    invalid.push({ path: TAXONOMY_FILE, error: err.message });
  }
  // P60: the project's brands and scope. A project.md that cannot be read leaves the scope `shared` (nothing filtered, nothing refused).
  let config: Pick<ProjectConfig, "knowledge" | "brands"> = { knowledge: { source: "files", scope: "shared" }, brands: [] };
  try {
    config = projectStore({ projects: root }).config(slug);
  } catch {
    /* no readable project.md: shared */
  }
  const entries: PlannedEntry[] = [];
  for (const path of files) {
    const text = readFileSync(join(folder, path), "utf8");
    let entry: Entry;
    try {
      entry = parseEntry(text);
    } catch (err) {
      if (!(err instanceof EntryError)) throw err;
      invalid.push({ path, error: err.message });
      continue;
    }
    if (taxonomy) {
      const found = checkAgainstTaxonomy(entry.front, taxonomy);
      for (const w of found.filter((x) => x.severity === "warning")) warnings.push({ path, message: w.message });
      const errors = found.filter((x) => x.severity === "error");
      if (errors.length) {
        // an entry that would be silently hidden from audience-filtered search is not indexed; a row from an earlier run is removed with it
        invalid.push({ path, error: errors.map((x) => x.message).join("; ") });
        continue;
      }
    }
    const brandProblem = entryBrandProblem(entry.front.brands, config);
    if (brandProblem) {
      // like an unknown audience: an entry that would answer for the wrong product, or for none, is not indexed
      invalid.push({ path, error: brandProblem });
      continue;
    }
    entries.push({ path, hash: sha256(text), entry, brands: canonicalBrands(entry.front.brands ?? [], config.brands) });
  }
  return { files: files.length, entries, invalid, warnings };
}

/** The stored `brands` column as a list (an unreadable value is empty). */
export const storedBrands = (json: string): string[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** Two brand lists name the same brands (order does not matter). */
export const sameBrands = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/**
 * Incremental reindex of `<root>/<slug>/knowledge/**.md` into `knowledge_docs` (and, through triggers, the FTS index),
 * by content hash and brands: a row is rewritten when its file's hash or its canonical brands differ (P140 K1: a column added
 * later, or a `## Brands` rename, is healed without a file edit). Rows whose file is gone are deleted.
 */
export async function indexProject(repos: Repos, root: string, slug: string, at?: string): Promise<IndexResult> {
  const plan = planProject(root, slug);
  const known = new Map((await repos.knowledge.list(slug)).map((r) => [r.path, r]));
  const result: IndexResult = { files: plan.files, added: 0, updated: 0, unchanged: 0, deleted: 0, invalid: plan.invalid, warnings: plan.warnings };
  const keep: string[] = [];
  for (const { path, hash, entry, brands } of plan.entries) {
    keep.push(path);
    const before = known.get(path);
    if (before && before.contentHash === hash && sameBrands(storedBrands(before.brands), brands)) {
      result.unchanged++;
      continue;
    }
    const f = entry.front;
    await repos.knowledge.upsert(
      slug,
      {
        path,
        title: f.title,
        use: f.use,
        approved: f.approved,
        audiences: f.audiences,
        brands,
        category: f.category ?? null,
        kind: f.kind ?? null,
        validUntil: f.valid_until ?? null,
        body: entry.body,
        phrasings: (f.phrasings ?? []).join(" | "),
        frontMatter: f as unknown as Record<string, unknown>,
        contentHash: hash,
      },
      at,
    );
    if (before === undefined) result.added++;
    else result.updated++;
  }
  result.deleted = await repos.knowledge.deleteMissing(slug, keep);
  return result;
}
