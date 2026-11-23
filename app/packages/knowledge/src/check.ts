import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isExpired, type Repos } from "@hub/db";
import { projectStore } from "@hub/projects/store";
import { entryBrandProblem } from "@hub/projects/brands";
import type { ProjectConfig } from "@hub/projects/model";
import { EntryError, parseEntry } from "./entry";
import { walkMarkdown } from "./indexer";
import { checkAgainstTaxonomy, loadTaxonomy, TAXONOMY_FILE, TaxonomyError, type Taxonomy } from "./taxonomy";

export interface CheckReport {
  project: string;
  /** `.md` files under knowledge/files and knowledge/notion. */
  files: { files: number; notion: number };
  indexed: number;
  approved: number;
  unapproved: number;
  expired: number;
  noAudiences: number;
  noPhrasings: number;
  byUse: { STATE: number; MARKER: number };
  /** Files with no row, rows with no file, and files that do not parse. */
  notIndexed: string[];
  orphanRows: string[];
  invalid: Array<{ path: string; error: string }>;
  /** The first few paths of each gap, for the report the skill prints. */
  examples: { unapproved: string[]; expired: string[]; noAudiences: string[]; noPhrasings: string[] };
  /** Advisory findings of knowledge/taxonomy.md (category, stages, kind); `taxonomy` says whether the file exists. */
  taxonomy: boolean;
  warnings: Array<{ path: string; message: string }>;
  /** files on disk = rows in the index, and nothing is invalid. */
  consistent: boolean;
}

export async function checkProject(repos: Repos, root: string, slug: string, today: string = new Date().toISOString().slice(0, 10)): Promise<CheckReport> {
  const folder = join(root, slug);
  if (!existsSync(folder)) throw new Error(`no such project folder: ${folder}`);
  const rows = await repos.knowledge.list(slug);
  const onDisk = walkMarkdown(join(folder, "knowledge"), folder);
  const rowPaths = new Set(rows.map((r) => r.path));
  const diskPaths = new Set(onDisk);

  const invalid: CheckReport["invalid"] = [];
  const warnings: CheckReport["warnings"] = [];
  let taxonomy: Taxonomy | null = null;
  try {
    taxonomy = loadTaxonomy(folder);
  } catch (err) {
    if (!(err instanceof TaxonomyError)) throw err;
    invalid.push({ path: TAXONOMY_FILE, error: err.message });
  }
  let config: Pick<ProjectConfig, "knowledge" | "brands"> = { knowledge: { source: "files", scope: "shared" }, brands: [] };
  try {
    config = projectStore({ projects: root }).config(slug);
  } catch {
    /* no readable project.md: shared, as the indexer */
  }
  for (const path of onDisk) {
    try {
      const entry = parseEntry(readFileSync(join(folder, path), "utf8"));
      const brandProblem = entryBrandProblem(entry.front.brands, config);
      if (brandProblem) invalid.push({ path, error: brandProblem });
      for (const f of taxonomy ? checkAgainstTaxonomy(entry.front, taxonomy) : []) {
        if (f.severity === "error") invalid.push({ path, error: f.message });
        else warnings.push({ path, message: f.message });
      }
    } catch (err) {
      if (!(err instanceof EntryError)) throw err;
      invalid.push({ path, error: err.message });
    }
  }

  const gaps = { unapproved: [] as string[], expired: [] as string[], noAudiences: [] as string[], noPhrasings: [] as string[] };
  const report: CheckReport = {
    project: slug,
    files: { files: onDisk.filter((p) => p.startsWith("knowledge/files/")).length, notion: onDisk.filter((p) => p.startsWith("knowledge/notion/")).length },
    indexed: rows.length,
    approved: 0,
    unapproved: 0,
    expired: 0,
    noAudiences: 0,
    noPhrasings: 0,
    byUse: { STATE: 0, MARKER: 0 },
    notIndexed: onDisk.filter((p) => !rowPaths.has(p) && !invalid.some((i) => i.path === p)),
    orphanRows: rows.filter((r) => !diskPaths.has(r.path)).map((r) => r.path),
    invalid,
    examples: { unapproved: [], expired: [], noAudiences: [], noPhrasings: [] },
    taxonomy: taxonomy !== null,
    warnings,
    consistent: false,
  };
  for (const r of rows) {
    report.byUse[r.use]++;
    if (r.approved) report.approved++;
    else (report.unapproved++, gaps.unapproved.push(r.path));
    if (isExpired(r.validUntil, today)) (report.expired++, gaps.expired.push(r.path));
    if (JSON.parse(r.audiences).length === 0) (report.noAudiences++, gaps.noAudiences.push(r.path));
    if (r.phrasings.trim() === "") (report.noPhrasings++, gaps.noPhrasings.push(r.path));
  }
  report.examples = {
    unapproved: gaps.unapproved.slice(0, 5),
    expired: gaps.expired.slice(0, 5),
    noAudiences: gaps.noAudiences.slice(0, 5),
    noPhrasings: gaps.noPhrasings.slice(0, 5),
  };
  report.consistent = onDisk.length === rows.length && report.notIndexed.length === 0 && report.orphanRows.length === 0 && invalid.length === 0;
  return report;
}

export function formatReport(r: CheckReport): string {
  const lines = [
    `project ${r.project}: ${r.files.files} files + ${r.files.notion} notion = ${r.files.files + r.files.notion} on disk, ${r.indexed} indexed`,
    `approved ${r.approved}, unapproved ${r.unapproved}, expired ${r.expired}; STATE ${r.byUse.STATE}, MARKER ${r.byUse.MARKER}`,
    `no audiences ${r.noAudiences}, no phrasings ${r.noPhrasings}`,
  ];
  const list = (label: string, items: string[]) => items.length && lines.push(`${label}: ${items.join(", ")}`);
  list("unapproved (first 5)", r.examples.unapproved);
  list("expired (first 5)", r.examples.expired);
  list("no audiences (first 5)", r.examples.noAudiences);
  list("no phrasings (first 5)", r.examples.noPhrasings);
  for (const w of r.warnings.slice(0, 10)) lines.push(`warning ${w.path}: ${w.message}`);
  if (r.warnings.length > 10) lines.push(`... ${r.warnings.length - 10} more taxonomy warnings`);
  list("not indexed (run knowledge index)", r.notIndexed);
  list("rows without a file (run knowledge index)", r.orphanRows);
  for (const i of r.invalid) lines.push(`invalid ${i.path}: ${i.error}`);
  lines.push(r.consistent ? "consistent: files on disk = rows in the index" : "NOT consistent");
  return lines.join("\n");
}
