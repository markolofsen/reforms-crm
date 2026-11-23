// P126 P2: the sections of project.md as specs. One row per section says its heading, its columns and how many of
// them are required; a column past `required` is trailing and optional, so a table written before that column existed
// still parses (the five-column Brands of an older core is the six-column table without Display name). The readers
// (parse.ts, brands, the writer) take their headers, column counts and table messages from here; each section's row
// rules stay with its reader.
import type { Issue, IssueCode } from "./issues";
import { tableOf, type Scan, type Section } from "./scan";

export interface TableSpec {
  kind: "table";
  /** The heading as written, e.g. "Settings"; matched lower-cased. */
  title: string;
  /** The column titles as written in a header line. */
  columns: readonly string[];
  /** How many leading columns a header must have; the rest may be left off from the end. */
  required: number;
  /** The issue code of a malformed table. */
  code: Extract<IssueCode, "bad_table" | "bad_link">;
  /** The `field` an issue of this table carries, if any. */
  field?: string;
  /** A section whose table may be missing altogether (Answers starts empty). */
  headerOptional?: boolean;
}

export interface ListSpec {
  kind: "list";
  title: string;
}

export type SectionSpec = TableSpec | ListSpec;

export const SECTIONS = {
  settings: { kind: "table", title: "Settings", columns: ["Field", "Value", "Answered", "By"], required: 4, code: "bad_table" },
  answers: { kind: "table", title: "Answers", columns: ["Date", "Field", "Question", "Answer"], required: 4, code: "bad_table", headerOptional: true },
  brands: { kind: "table", title: "Brands", columns: ["Brand", "Receives at", "Signature", "Answered", "By", "Display name"], required: 5, code: "bad_table", field: "brands" },
  links: { kind: "table", title: "Links", columns: ["Group", "Label", "Target", "Under", "Answered", "By"], required: 6, code: "bad_link", field: "links" },
  databases: { kind: "list", title: "Notion databases" },
} as const satisfies Record<string, SectionSpec>;

export type SectionKey = keyof typeof SECTIONS;

/** The lower-cased heading `scan` gives a section. */
export const sectionName = (spec: SectionSpec): string => spec.title.toLowerCase();

export const findSection = (sc: Scan, spec: SectionSpec): Section | undefined => sc.sections.find((s) => s.name === sectionName(spec));

/** The full header line a writer puts down, every column included. */
export const headerLine = (spec: TableSpec): string => `| ${spec.columns.join(" | ")} |`;
export const separatorLine = (spec: TableSpec): string => `|${spec.columns.map(() => "---").join("|")}|`;

export interface SpecRow {
  /** Cells padded with "" to every column of the spec, so a reader destructures one shape. */
  cells: string[];
  /** Index of the line. */
  idx: number;
  /** 1-based line. */
  line: number;
}

export interface SpecTable {
  section: Section;
  /** How many columns the header has (between `required` and every column). */
  width: number;
  headerIdx: number;
  rows: SpecRow[];
  issues: Issue[];
  /** The header did not match: `rows` is empty and `issues` says why. */
  bad: boolean;
}

const columnsText = (spec: TableSpec): string => {
  const head = spec.columns.slice(0, spec.required).join(" | ");
  const rest = spec.columns.slice(spec.required);
  return rest.length ? `${head}, with optional ${rest.join(" | ")}` : head;
};

/** Whether a header is the spec's columns, all required ones present and any optional ones in order from the left. */
export function headerWidth(spec: TableSpec, header: string[] | null): number | null {
  if (header === null) return null;
  if (header.length < spec.required || header.length > spec.columns.length) return null;
  return header.every((c, i) => c.toLowerCase() === spec.columns[i]?.toLowerCase()) ? header.length : null;
}

/**
 * Reads one table section against its spec. Returns null when the section is absent. A header that does not match
 * gives one issue and no rows; a row whose cell count differs from the header gives one issue and is skipped.
 */
export function readTable(lines: string[], sc: Scan, spec: TableSpec): SpecTable | null {
  const section = findSection(sc, spec);
  if (!section) return null;
  const t = tableOf(lines, sc.fenced, section);
  const issues: Issue[] = [];
  const issue = (line: number, message: string) => issues.push({ severity: "error", code: spec.code, line, ...(spec.field ? { field: spec.field } : {}), message });
  if (t.header === null && spec.headerOptional) return { section, width: spec.columns.length, headerIdx: -1, rows: [], issues, bad: false };
  const width = headerWidth(spec, t.header);
  if (width === null) {
    issue(t.headerIdx >= 0 ? t.headerIdx + 1 : section.start + 1, `## ${spec.title} needs a table with the columns ${columnsText(spec)}`);
    return { section, width: 0, headerIdx: t.headerIdx, rows: [], issues, bad: true };
  }
  const rows: SpecRow[] = [];
  const article = /^[aeiou]/i.test(spec.title) ? "an" : "a";
  for (const r of t.rows) {
    const line = r.idx + 1;
    if (r.cells.length !== width) {
      issue(line, `${article} ${spec.title} row has ${r.cells.length} cells, expected ${width} (escape "|" in a value as "\\|")`);
      continue;
    }
    rows.push({ cells: [...r.cells, ...new Array<string>(spec.columns.length - width).fill("")], idx: r.idx, line });
  }
  return { section, width, headerIdx: t.headerIdx, rows, issues, bad: false };
}
