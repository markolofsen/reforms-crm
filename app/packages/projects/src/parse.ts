// project.md schema v1 (doc 16 section 3). Pure: text in, structure and issues out. No file or database access, so
// @hub/notion can import this file alone.

import { checkValue, FIELDS, readField, setPath } from "./fields.js";
import { DEFAULT_KIND, hasValue, kindOf } from "./kinds.js";
import { BYS, ProjectBase, STATUSES, type By, type ProjectConfig, type ProjectDatabase, type ProjectStatus } from "./schema.js";
import { EMAIL, isIsoDate, normalizeAddress, normalizeId, SLUG, splitList, UUID } from "./values.js";

export const SCHEMA_VERSION = 1;

export { BYS, STATUSES, checkValue, FIELDS, isIsoDate, normalizeAddress, normalizeId };
export type { By, ProjectConfig, ProjectDatabase, ProjectStatus };
export type { KnowledgeSource } from "./schema.js";

export type IssueCode =
  | "bad_slug"
  | "unknown_schema"
  | "missing_required"
  | "bad_date"
  | "bad_value"
  | "bad_table"
  | "bad_by"
  | "unknown_field"
  | "duplicate_row"
  | "stray_list_item"
  | "bad_database_id"
  | "duplicate_database";

export interface Issue {
  severity: "error" | "warning";
  code: IssueCode;
  /** 1-based line in project.md, when the issue has one. */
  line: number | null;
  field?: string;
  message: string;
}

export interface SettingRow {
  field: string;
  value: string;
  answered: string;
  by: By;
  line: number;
}

export interface AnswerRow {
  date: string;
  field: string;
  question: string;
  answer: string;
  line: number;
}

export interface ParsedProject {
  slug: string;
  /** `v1`: has `## Settings`. `adopt`: only the databases list (the layout that predates schema v1). */
  mode: "v1" | "adopt";
  name: string;
  summary: string;
  settings: Record<string, SettingRow>;
  databases: ProjectDatabase[];
  answers: AnswerRow[];
  issues: Issue[];
  /** Missing required fields were found (an error for active/paused projects, a warning for drafts). */
  incomplete: boolean;
  /** Resolved values with defaults. Always present; meaningful when `issues` has no error. */
  config: ProjectConfig;
}

export class ProjectError extends Error {
  constructor(readonly issues: Issue[]) {
    super(issues.filter((i) => i.severity === "error").map(formatIssue).join("\n") || "invalid project.md");
    this.name = "ProjectError";
  }
}

export const formatIssue = (i: Issue): string =>
  `${i.severity}: ${i.code}${i.line ? ` (line ${i.line})` : ""}${i.field ? ` [${i.field}]` : ""}: ${i.message}`;

export const hasErrors = (issues: Issue[]): boolean => issues.some((i) => i.severity === "error");

const ITEM = /^\s*[-*]\s+([a-z0-9][a-z0-9_-]*)\s*:\s*(\S+)/;

// ---- scanning ---------------------------------------------------------------------------------------------------

export interface Section {
  /** Lower-cased heading text. */
  name: string;
  /** Index into the line array of the `## ` heading. */
  start: number;
  /** Index of the first line after the section. */
  end: number;
}

export interface Scan {
  title: string | null;
  titleLine: number;
  /** Lines of the fence-free scan: index -> true when inside a fenced block. */
  fenced: boolean[];
  sections: Section[];
}

/** One pass over the lines (without terminators): fences, the `# ` title and the `## ` sections. */
export function scan(lines: string[]): Scan {
  const fenced: boolean[] = new Array<boolean>(lines.length).fill(false);
  const sections: Section[] = [];
  let title: string | null = null;
  let titleLine = -1;
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced[i] = true;
      fence = !fence;
      return;
    }
    if (fence) {
      fenced[i] = true;
      return;
    }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2?.[1]) {
      const last = sections[sections.length - 1];
      if (last) last.end = i;
      sections.push({ name: h2[1].toLowerCase(), start: i, end: lines.length });
      return;
    }
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1?.[1] && title === null && sections.length === 0) {
      title = h1[1];
      titleLine = i;
    }
  });
  return { title, titleLine, fenced, sections };
}

export const splitLines = (text: string): string[] => text.split(/\r?\n/);

export function splitRow(line: string): string[] {
  const t = line.trim();
  const inner = t.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

const isSeparatorRow = (cells: string[]): boolean => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

/** The table rows of a section: header cells and the data rows with their line index. */
export function tableOf(lines: string[], fenced: boolean[], s: Section): { header: string[] | null; headerIdx: number; rows: Array<{ cells: string[]; idx: number }>; lastIdx: number } {
  let header: string[] | null = null;
  let headerIdx = -1;
  let lastIdx = -1;
  const rows: Array<{ cells: string[]; idx: number }> = [];
  for (let i = s.start + 1; i < s.end; i++) {
    const line = lines[i] ?? "";
    if (fenced[i] || !line.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    lastIdx = i;
    if (header === null) {
      header = cells;
      headerIdx = i;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    rows.push({ cells, idx: i });
  }
  return { header, headerIdx, rows, lastIdx };
}

// ---- parsing ----------------------------------------------------------------------------------------------------

const same = (a: string[] | null, want: string[]) =>
  a !== null && a.length === want.length && a.every((c, i) => c.toLowerCase() === want[i]);

/**
 * The `## Notion databases` list and the display name. Legacy layout: a file with no `## ` heading at all keeps its
 * list items anywhere (that is how the pre-v1 project files are written); as soon as the file has sections, only
 * the items under `## Notion databases` are databases and any other `- key: value` item is an error.
 */
export function extractDatabases(text: string): { name: string | null; databases: ProjectDatabase[]; issues: Issue[]; legacy: boolean } {
  const lines = splitLines(text);
  const sc = scan(lines);
  const legacy = sc.sections.length === 0;
  const dbSection = sc.sections.find((s) => s.name === "notion databases");
  const issues: Issue[] = [];
  const databases: ProjectDatabase[] = [];
  const seen = new Set<string>();

  lines.forEach((line, i) => {
    if (sc.fenced[i]) return;
    const item = ITEM.exec(line);
    if (!item) return;
    const [, slug, rawId] = item as unknown as [string, string, string];
    const inDb = legacy || (dbSection !== undefined && i > dbSection.start && i < dbSection.end);
    if (!inDb) {
      issues.push({
        severity: "error",
        code: "stray_list_item",
        line: i + 1,
        message: `"- ${slug}: ..." outside "## Notion databases" is read as a database; use a table or a sentence (or move it under that heading)`,
      });
      return;
    }
    if (!UUID.test(rawId)) {
      issues.push({ severity: "error", code: "bad_database_id", line: i + 1, field: slug, message: `"${slug}" has no valid data source id (got "${rawId}")` });
      return;
    }
    if (seen.has(slug)) {
      issues.push({ severity: "error", code: "duplicate_database", line: i + 1, field: slug, message: `duplicate database slug "${slug}"` });
      return;
    }
    seen.add(slug);
    databases.push({ slug, dataSourceId: normalizeId(rawId) });
  });
  return { name: sc.title, databases, issues, legacy };
}

/**
 * Parses and validates one project.md. Never throws: problems come back as `issues`. `slug` is the folder name.
 * A project in `draft` may be incomplete (setup fills it row by row): missing required fields are warnings there and
 * errors for `active` and `paused`.
 */
export function parseProjectMd(text: string, slug: string): ParsedProject {
  const lines = splitLines(text);
  const sc = scan(lines);
  const issues: Issue[] = [];
  const settings: Record<string, SettingRow> = {};
  const answers: AnswerRow[] = [];

  if (!SLUG.test(slug)) {
    issues.push({ severity: "error", code: "bad_slug", line: null, message: `folder name "${slug}" must match [a-z0-9-]+` });
  }

  const dbs = extractDatabases(text);
  issues.push(...dbs.issues);

  const settingsSection = sc.sections.find((s) => s.name === "settings");
  const answersSection = sc.sections.find((s) => s.name === "answers");

  // summary: prose between the title and the first section
  const firstSection = sc.sections[0]?.start ?? lines.length;
  const summary = lines
    .slice(sc.titleLine + 1, firstSection)
    .filter((l) => l.trim() !== "" && !(dbs.legacy && ITEM.test(l)))
    .join(" ")
    .trim();

  if (settingsSection) {
    const t = tableOf(lines, sc.fenced, settingsSection);
    if (!same(t.header, ["field", "value", "answered", "by"])) {
      issues.push({
        severity: "error",
        code: "bad_table",
        line: t.headerIdx >= 0 ? t.headerIdx + 1 : settingsSection.start + 1,
        message: "## Settings needs a table with the columns Field | Value | Answered | By",
      });
    } else {
      for (const r of t.rows) {
        const line = r.idx + 1;
        if (r.cells.length !== 4) {
          issues.push({ severity: "error", code: "bad_table", line, message: `a Settings row has ${r.cells.length} cells, expected 4 (escape "|" in a value as "\\|")` });
          continue;
        }
        const [field, value, answered, by] = r.cells as [string, string, string, string];
        if (field === "notion.databases") {
          issues.push({ severity: "error", code: "bad_value", line, field, message: "notion.databases is the ## Notion databases section, not a Settings row" });
          continue;
        }
        if (!(field in FIELDS)) {
          issues.push({ severity: "error", code: "unknown_field", line, field, message: `unknown field "${field}"` });
          continue;
        }
        if (settings[field]) {
          issues.push({ severity: "error", code: "duplicate_row", line, field, message: `"${field}" is set twice (first on line ${settings[field]?.line})` });
          continue;
        }
        const bad = checkValue(field, value);
        if (bad) issues.push({ severity: "error", code: "bad_value", line, field, message: bad });
        if (!isIsoDate(answered)) {
          issues.push({ severity: "error", code: "bad_date", line, field, message: `Answered "${answered}" is not an ISO date (YYYY-MM-DD)` });
        }
        if (!(BYS as readonly string[]).includes(by)) {
          issues.push({ severity: "error", code: "bad_by", line, field, message: `By "${by}" must be one of ${BYS.join(", ")}` });
        }
        settings[field] = { field, value, answered, by: by as By, line };
      }
    }
  }

  if (answersSection) {
    const t = tableOf(lines, sc.fenced, answersSection);
    if (t.header && !same(t.header, ["date", "field", "question", "answer"])) {
      issues.push({ severity: "error", code: "bad_table", line: t.headerIdx + 1, message: "## Answers needs the columns Date | Field | Question | Answer" });
    } else {
      for (const r of t.rows) {
        const line = r.idx + 1;
        if (r.cells.length !== 4) {
          issues.push({ severity: "error", code: "bad_table", line, message: `an Answers row has ${r.cells.length} cells, expected 4` });
          continue;
        }
        const [date, field, question, answer] = r.cells as [string, string, string, string];
        if (!isIsoDate(date)) issues.push({ severity: "error", code: "bad_date", line, message: `Answers date "${date}" is not an ISO date` });
        answers.push({ date, field, question, answer, line });
      }
    }
  }

  const mode: ParsedProject["mode"] = settingsSection ? "v1" : "adopt";
  const get = (f: string): string | undefined => settings[f]?.value;

  // schema version: an unknown one stops further interpretation (the other rules may have changed)
  if (mode === "v1") {
    const sv = get("schema");
    if (sv !== undefined && /^\d+$/.test(sv) && Number(sv) !== SCHEMA_VERSION) {
      const row = settings.schema as SettingRow;
      issues.length = 0;
      issues.push({ severity: "error", code: "unknown_schema", line: row.line, field: "schema", message: `schema ${sv} is not supported (this parser reads schema ${SCHEMA_VERSION})` });
    }
  }

  // the resolved config: every Settings row lands on its path (fields.ts), the kind supplies modules and defaults
  const raw: Record<string, unknown> = {};
  for (const [field, row] of Object.entries(settings)) {
    const v = readField(field, row.value);
    if (v !== undefined) setPath(raw, (FIELDS[field] as (typeof FIELDS)[string]).path, v);
  }
  const kindId = typeof raw.kind === "string" ? raw.kind : DEFAULT_KIND;
  const kind = kindOf(kindId) ?? (kindOf(DEFAULT_KIND) as NonNullable<ReturnType<typeof kindOf>>);
  const mail = (raw.mail ??= {}) as Record<string, string[] | string | undefined>;
  const accounts = (mail.accounts as string[] | undefined) ?? [];
  const declared = (mail.addresses as string[] | undefined) ?? accounts.filter((a) => EMAIL.test(a)).map(normalizeAddress);
  const aliases = [...new Set((mail.aliases as string[] | undefined) ?? [])];
  mail.addresses = [...new Set([...declared, ...aliases])];
  mail.aliases = aliases;
  mail.sender ??= declared[0];
  const config = ProjectBase.parse({
    ...raw,
    schema: 1,
    slug,
    kind: kind.id,
    name: (raw.name as string | undefined) || dbs.name || slug,
    modules: kind.modules,
    languages: raw.languages ?? kind.defaults.languages,
    notion: { ...(raw.notion as object | undefined), databases: dbs.databases },
    send: { dailyCap: kind.send.dailyCap, delayMinutes: kind.send.delayMinutes, ...(raw.send as object | undefined) },
  });
  const status = config.status;

  // required fields (v1 only; adopt mode is asked for them by project-setup). `schema` is structural; the rest is the kind's list.
  let incomplete = false;
  if (mode === "v1" && !issues.some((i) => i.code === "unknown_schema")) {
    const sev: Issue["severity"] = status === "draft" ? "warning" : "error";
    const missing = (field: string, message: string) => {
      incomplete = true;
      issues.push({ severity: sev, code: "missing_required", line: null, field, message });
    };
    if (!get("schema")) missing("schema", 'required field "schema" has no value');
    for (const path of kind.required) {
      if (hasValue(config, path)) continue;
      if (path.startsWith("notion.databases.")) missing("notion.databases", `required: "## Notion databases" must list "${path.slice("notion.databases.".length)}" (kind ${kind.id})`);
      else if (path === "mail.sender") missing(path, 'required: set "mail.sender" or list "mail.addresses" (the first becomes the sender)');
      else missing(path, `required field "${path}" has no value (kind ${kind.id})`);
    }
    const sendLine = settings["send.classes"]?.line ?? settings["send.mode"]?.line ?? null;
    const unknownClasses = config.send.classes.filter((cl) => !kind.send.classes.includes(cl));
    if (unknownClasses.length) {
      issues.push({ severity: "error", code: "bad_value", line: settings["send.classes"]?.line ?? null, field: "send.classes", message: `${unknownClasses.join(", ")}: not a class a ${kind.id} project may autosend (allowed: ${kind.send.classes.join(", ")})` });
    }
    if (config.send.mode === "auto" && config.send.classes.length === 0) {
      issues.push({ severity: sev, code: "bad_value", line: sendLine, field: "send.classes", message: "send.mode is auto but send.classes is empty: nothing could be sent" });
    }
    if (status === "active" && config.setup.doctor && !/ pass$/.test(config.setup.doctor)) {
      issues.push({ severity: "warning", code: "bad_value", line: settings["setup.doctor"]?.line ?? null, field: "setup.doctor", message: "status is active but the last doctor result is not a pass" });
    }
  }

  return { slug, mode, name: config.name, summary, settings, databases: dbs.databases, answers, issues, incomplete, config };
}

/** parseProjectMd, throwing a ProjectError when there is an error-level issue. */
export function readProject(text: string, slug: string): ParsedProject {
  const p = parseProjectMd(text, slug);
  if (hasErrors(p.issues)) throw new ProjectError(p.issues);
  return p;
}
