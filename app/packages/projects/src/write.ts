// In-place edits of project.md: table rows only, every other byte stays. Pure text functions plus thin file wrappers.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isPolicyField } from "./fields";
import { BYS, checkValue, FIELDS, isIsoDate, ProjectError, scan, tableOf, type By, type Issue } from "./parse";

const SETTINGS_HEADER = "| Field | Value | Answered | By |";
const ANSWERS_HEADER = "| Date | Field | Question | Answer |";

/** Lines with their terminators, so joining them gives the original bytes back. */
const rawLines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const bare = (raw: string): string => raw.replace(/\r?\n$/, "");
const eolOf = (raw: string | undefined, fallback: string): string => (raw && /\r\n$/.test(raw) ? "\r\n" : raw && /\n$/.test(raw) ? "\n" : fallback);

export const escapeCell = (v: string): string => v.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();

export const localDate = (d: Date = new Date()): string => d.toLocaleDateString("en-CA");

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
  // P49 S11: the send policy is not a project.md field any more; only a person changes it, outside the agent's reach.
  else if (isPolicyField(field)) bad.push({ severity: "error", code: "send_policy_in_project_md", line: null, field, message: `${field} is the send policy, not a project.md row: a person sets it with \`hub send policy set <slug> ${field} <value>\`` });
  else {
    const msg = checkValue(field, value);
    if (msg) bad.push({ severity: "error", code: "bad_value", line: null, field, message: msg });
  }
  if (!isIsoDate(date)) bad.push({ severity: "error", code: "bad_date", line: null, field, message: `"${date}" is not an ISO date` });
  if (!(BYS as readonly string[]).includes(by)) bad.push({ severity: "error", code: "bad_by", line: null, field, message: `By "${by}" must be one of ${BYS.join(", ")}` });
  if (bad.length) throw new ProjectError(bad);

  const raws = rawLines(text);
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

/** Removes the Settings rows of `fields` (the send-policy migration); every other byte stays. */
export function removeSettings(text: string, fields: readonly string[]): string {
  const raws = rawLines(text);
  const lines = raws.map(bare);
  const sc = scan(lines);
  const settings = sc.sections.find((s) => s.name === "settings");
  if (!settings) return text;
  const t = tableOf(lines, sc.fenced, settings);
  const drop = new Set(t.rows.filter((r) => fields.includes(r.cells[0] ?? "")).map((r) => r.idx));
  return raws.filter((_, i) => !drop.has(i)).join("");
}

/** Appends one row to `## Answers` (the log is append-only), creating the section before `## Notes` or at the end. */
export function applyAnswer(text: string, a: { date: string; field: string; question: string; answer: string }): string {
  if (!isIsoDate(a.date)) throw new ProjectError([{ severity: "error", code: "bad_date", line: null, message: `"${a.date}" is not an ISO date` }]);
  const raws = rawLines(text);
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

export function rewrite(file: string, edit: (text: string) => string): void {
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
