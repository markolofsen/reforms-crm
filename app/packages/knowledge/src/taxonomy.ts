// `knowledge/taxonomy.md` (P19, research 09 section 5A): the words a project's entries may use on the axes that
// matter. `audiences` is ENFORCED (a typo silently hides an entry from audience-filtered search); `category`,
// `stages` and `kind` are ADVISORY (display only today, so an unknown value is a warning with the nearest word).
// No file, no validation: a project without one starts as before. The file is data, parsed here and nowhere else.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FrontMatter } from "./entry.js";

export const TAXONOMY_FILE = "knowledge/taxonomy.md";
export const AXES = ["audiences", "category", "stages", "kind"] as const;
export type Axis = (typeof AXES)[number];
export type Taxonomy = Partial<Record<Axis, string[]>>;

const WORD = /^[A-Z][A-Z0-9_]*$/;

export interface TaxonomyIssue {
  severity: "error" | "warning";
  axis: Axis;
  value: string;
  message: string;
}

export class TaxonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxonomyError";
  }
}

/**
 * Sections are `## <axis>` followed by words separated by commas, spaces or line breaks (a `- ` bullet is allowed).
 * An unknown section, a word that is not UPPER_SNAKE, or an empty declared axis throws a TaxonomyError.
 * Text before the first `## ` heading is prose and ignored.
 */
export function parseTaxonomy(text: string): Taxonomy {
  const out: Taxonomy = {};
  let axis: Axis | null = null;
  let fence = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = /^##\s+(.+?)\s*$/.exec(raw);
    if (h) {
      const name = (h[1] as string).toLowerCase();
      if (!(AXES as readonly string[]).includes(name)) throw new TaxonomyError(`unknown section "## ${h[1]}"; sections are ${AXES.join(", ")}`);
      axis = name as Axis;
      if (out[axis]) throw new TaxonomyError(`section "## ${name}" appears twice`);
      out[axis] = [];
      continue;
    }
    if (axis === null) continue;
    for (const w of raw.replace(/^\s*[-*]\s+/, "").split(/[,\s]+/).filter(Boolean)) {
      if (!WORD.test(w)) throw new TaxonomyError(`"${w}" under "## ${axis}" must be UPPER_SNAKE_CASE`);
      (out[axis] as string[]).push(w);
    }
  }
  for (const a of AXES) if (out[a] && out[a]?.length === 0) throw new TaxonomyError(`section "## ${a}" is empty; remove it or list its words`);
  return out;
}

/** The taxonomy of a project folder, or null when it has no `knowledge/taxonomy.md`. Throws TaxonomyError when the file is malformed. */
export function loadTaxonomy(projectFolder: string): Taxonomy | null {
  const file = join(projectFolder, TAXONOMY_FILE);
  if (!existsSync(file)) return null;
  return parseTaxonomy(readFileSync(file, "utf8"));
}

const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] as number;
      row[j] = Math.min((row[j] as number) + 1, (row[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length] as number;
};

const nearest = (value: string, words: string[]): string | null => {
  let best: string | null = null;
  let d = Infinity;
  for (const w of words) {
    const x = distance(value, w);
    if (x < d) (d = x, (best = w));
  }
  return best !== null && d <= Math.max(2, Math.floor(value.length / 3)) ? best : null;
};

/** Values of one entry outside the declared words. Axes the taxonomy does not declare are not checked. */
export function checkAgainstTaxonomy(front: FrontMatter, t: Taxonomy): TaxonomyIssue[] {
  const issues: TaxonomyIssue[] = [];
  const values: Record<Axis, string[]> = {
    audiences: front.audiences,
    category: front.category ? [front.category] : [],
    stages: front.stages ?? [],
    kind: front.kind ? [front.kind] : [],
  };
  for (const axis of AXES) {
    const allowed = t[axis];
    if (!allowed) continue;
    for (const value of values[axis]) {
      if (allowed.includes(value)) continue;
      const near = nearest(value, allowed);
      issues.push({
        severity: axis === "audiences" ? "error" : "warning",
        axis,
        value,
        message: `${axis} "${value}" is not in ${TAXONOMY_FILE}${near ? `; did you mean ${near}?` : ""} (declared: ${allowed.join(", ")})`,
      });
    }
  }
  return issues;
}
