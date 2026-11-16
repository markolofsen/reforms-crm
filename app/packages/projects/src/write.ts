// In-place edits of project.md: table rows only, every other byte stays. Pure text functions plus thin file wrappers.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BYS, checkValue, FIELDS, isIsoDate, ProjectError, scan, tableOf, type By, type Issue } from "./parse.js";

const SETTINGS_HEADER = "| Field | Value | Answered | By |";
const ANSWERS_HEADER = "| Date | Field | Question | Answer |";

/** Lines with their terminators, so joining them gives the original bytes back. */
const rawLines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const bare = (raw: string): string => raw.replace(/\r?\n$/, "");
const eolOf = (raw: string | undefined, fallback: string): string => (raw && /\r\n$/.test(raw) ? "\r\n" : raw && /\n$/.test(raw) ? "\n" : fallback);

export const escapeCell = (v: string): string => v.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();

export const localDate = (d: Date = new Date()): string => d.toLocaleDateString("en-CA");

/**
 * A file with no `## ` heading keeps its databases list loose under the title (the legacy layout that predates schema v1). Adopting it inserts one `## Notion databases` heading above the first list item; the list itself is
 * not touched. Any file that already has sections is returned as is.
 */
export function ensureDatabasesHeading(text: string): string {
  const raws = rawLines(text);
  const lines = raws.map(bare);
  const sc = scan(lines);
  if (sc.sections.length > 0) return text;
  const first = lines.findIndex((l, i) => !sc.fenced[i] && /^\s*[-*]\s+[a-z0-9][a-z0-9_-]*\s*:\s*\S/.test(l));
  if (first < 0) return text;
  const eol = eolOf(raws[first], "\n");
  const before = first > 0 && (lines[first - 1] ?? "").trim() === "" ? [] : [eol];
  raws.splice(first, 0, ...before, `## Notion databases${eol}`, eol);
  return raws.join("");
}

function insertAt(raws: string[], idx: number, add: string[]): string {
  const out = [...raws];
  // The line before an insertion point may lack a terminator (end of file): give it one.
  if (idx > 0 && idx === out.length && !/\n$/.test(out[idx - 1] ?? "")) out[idx - 1] = `${out[idx - 1]}\n`;
  out.splice(idx, 0, ...add);
  return out.join("");
}

function newSection(heading: string, header: string, row: string, eol: string): string[] {
  return [`${heading}${eol}`, eol, `${header}${eol}`, `|---|---|---|---|${eol}`, `${row}${eol}`, eol];
}

/**
 * Sets one Settings row (value, ISO date, By), replacing the row of that field or adding it after the last row of
 * the table. Creates `## Settings` when the file has none. Validates the value first and throws ProjectError.
 */
export function applySetting(text: string, field: string, value: string, by: By, date: string): string {
  const bad: Issue[] = [];
  if (field === "notion.databases") bad.push({ severity: "error", code: "bad_value", line: null, field, message: "notion.databases is the ## Notion databases section, not a Settings row" });
  else if (!(field in FIELDS)) bad.push({ severity: "error", code: "unknown_field", line: null, field, message: `unknown field "${field}"` });
  else {
    const msg = checkValue(field, value);
    if (msg) bad.push({ severity: "error", code: "bad_value", line: null, field, message: msg });
  }
  if (!isIsoDate(date)) bad.push({ severity: "error", code: "bad_date", line: null, field, message: `"${date}" is not an ISO date` });
  if (!(BYS as readonly string[]).includes(by)) bad.push({ severity: "error", code: "bad_by", line: null, field, message: `By "${by}" must be one of ${BYS.join(", ")}` });
  if (bad.length) throw new ProjectError(bad);

  const prepared = ensureDatabasesHeading(text);
  const raws = rawLines(prepared);
  const lines = raws.map(bare);
  const sc = scan(lines);
  const settings = sc.sections.find((s) => s.name === "settings");
  const eol = eolOf(raws.find((r) => r.endsWith("\n")), "\n");
  const row = `| ${escapeCell(field)} | ${escapeCell(value)} | ${date} | ${by} |`;

  if (!settings) {
    const before = sc.sections.find((s) => s.name === "notion databases") ?? sc.sections.find((s) => s.name === "answers") ?? sc.sections.find((s) => s.name === "notes");
    const at = before ? before.start : raws.length;
    const lead = !before && raws.length && (lines[lines.length - 1] ?? "").trim() !== "" ? [eol] : [];
    return insertAt(raws, at, [...lead, ...newSection("## Settings", SETTINGS_HEADER, row, eol)]);
  }

  const t = tableOf(lines, sc.fenced, settings);
  if (t.header === null) {
    return insertAt(raws, settings.start + 1, [eol, `${SETTINGS_HEADER}${eol}`, `|---|---|---|---|${eol}`, `${row}${eol}`]);
  }
  const existing = t.rows.find((r) => r.cells[0] === field);
  if (existing) {
    const old = raws[existing.idx] as string;
    raws[existing.idx] = `${row}${eolOf(old, "")}`;
    return raws.join("");
  }
  return insertAt(raws, t.lastIdx + 1, [`${row}${eol}`]);
}

/** Appends one row to `## Answers` (the log is append-only), creating the section before `## Notes` or at the end. */
export function applyAnswer(text: string, a: { date: string; field: string; question: string; answer: string }): string {
  if (!isIsoDate(a.date)) throw new ProjectError([{ severity: "error", code: "bad_date", line: null, message: `"${a.date}" is not an ISO date` }]);
  const prepared = ensureDatabasesHeading(text);
  const raws = rawLines(prepared);
  const lines = raws.map(bare);
  const sc = scan(lines);
  const eol = eolOf(raws.find((r) => r.endsWith("\n")), "\n");
  const row = `| ${a.date} | ${escapeCell(a.field)} | ${escapeCell(a.question)} | ${escapeCell(a.answer)} |`;
  const answers = sc.sections.find((s) => s.name === "answers");

  if (!answers) {
    const notes = sc.sections.find((s) => s.name === "notes");
    const at = notes ? notes.start : raws.length;
    const lead = !notes && raws.length && (lines[lines.length - 1] ?? "").trim() !== "" ? [eol] : [];
    return insertAt(raws, at, [...lead, ...newSection("## Answers", ANSWERS_HEADER, row, eol)]);
  }
  const t = tableOf(lines, sc.fenced, answers);
  if (t.header === null) {
    return insertAt(raws, answers.start + 1, [eol, `${ANSWERS_HEADER}${eol}`, `|---|---|---|---|${eol}`, `${row}${eol}`]);
  }
  return insertAt(raws, t.lastIdx + 1, [`${row}${eol}`]);
}

function rewrite(file: string, edit: (text: string) => string): void {
  const next = edit(readFileSync(file, "utf8"));
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, next);
  renameSync(tmp, file);
}

/** `folder` is <projects>/<slug>. */
export function writeSetting(folder: string, field: string, value: string, by: By, date: string = localDate()): void {
  rewrite(join(folder, "project.md"), (t) => applySetting(t, field, value, by, date));
}

export function appendAnswer(folder: string, a: { field: string; question: string; answer: string; date?: string }): void {
  rewrite(join(folder, "project.md"), (t) => applyAnswer(t, { ...a, date: a.date ?? localDate() }));
}
