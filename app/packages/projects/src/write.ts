// In-place edits of project.md: table rows only, every other byte stays. Pure text functions plus thin file wrappers.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANDS_HEADER, joinSignature, normalizedDisplayName } from "./brands";
import { isPolicyField } from "./fields";
import { ProjectError, type Issue } from "./md/issues";
import { scan, tableOf } from "./md/scan";
import { findSection, headerLine, SECTIONS } from "./md/sections";
import { BYS, checkValue, extractDatabases, FIELDS, isIsoDate, normalizeId, parseProjectMd, type By } from "./parse";
import { UUID } from "./values";

const SETTINGS_HEADER = headerLine(SECTIONS.settings);
const ANSWERS_HEADER = headerLine(SECTIONS.answers);
const LINKS_HEADER = headerLine(SECTIONS.links);

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

export interface LinkRowInput {
  group: string;
  label: string;
  target: string;
  under?: string | null;
  by: By;
  date: string;
}

/** Replaces the declarative `## Links` table and validates all rows before returning. */
export function applyLinkRows(text: string, slug: string, links: readonly LinkRowInput[]): string {
  const bad: Issue[] = [];
  for (const link of links) {
    if (!link.group.trim() || !link.label.trim()) bad.push({ severity: "error", code: "bad_link", line: null, field: "links", message: "a link needs a Group and Label" });
    if (!link.target.trim()) bad.push({ severity: "error", code: "bad_link", line: null, field: "links", message: `link "${link.label}" has no Target` });
    if (!isIsoDate(link.date)) bad.push({ severity: "error", code: "bad_date", line: null, field: "links", message: `"${link.date}" is not an ISO date` });
    if (!(BYS as readonly string[]).includes(link.by)) bad.push({ severity: "error", code: "bad_by", line: null, field: "links", message: `By "${link.by}" must be one of ${BYS.join(", ")}` });
  }
  if (bad.length) throw new ProjectError(bad);

  const raws = rawLines(text);
  const lines = raws.map(bare);
  const sc = scan(lines);
  const eol = eolOf(raws.find((raw) => raw.endsWith("\n")), "\n");
  const row = (link: LinkRowInput): string => `| ${escapeCell(link.group)} | ${escapeCell(link.label)} | ${escapeCell(link.target)} | ${escapeCell(link.under ?? "")} | ${link.date} | ${link.by} |`;
  const section = sc.sections.find((s) => s.name === "links");
  let next: string;

  if (!section) {
    const before = sc.sections.find((s) => s.name === "notion databases") ?? sc.sections.find((s) => s.name === "answers") ?? sc.sections.find((s) => s.name === "notes");
    const at = before ? before.start : raws.length;
    const lead = !before && raws.length && (lines[lines.length - 1] ?? "").trim() !== "" ? [eol] : [];
    next = insertAt(raws, at, [...lead, `## Links${eol}`, eol, `${LINKS_HEADER}${eol}`, `|---|---|---|---|---|---|${eol}`, ...links.map((link) => `${row(link)}${eol}`), eol]);
  } else {
    const table = tableOf(lines, sc.fenced, section);
    const start = table.headerIdx >= 0 ? table.headerIdx : section.start + 1;
    const end = table.lastIdx >= 0 ? table.lastIdx + 1 : section.end;
    const replacement = [`${LINKS_HEADER}${eol}`, `|---|---|---|---|---|---|${eol}`, ...links.map((link) => `${row(link)}${eol}`)];
    raws.splice(start, Math.max(0, end - start), ...replacement);
    next = raws.join("");
  }

  const linkErrors = parseProjectMd(next, slug).issues.filter((issue) => issue.field === "links" && issue.severity === "error");
  if (linkErrors.length) throw new ProjectError(linkErrors);
  return next;
}

/** `folder` is <projects>/<slug>. */
export function writeLinkRows(folder: string, slug: string, links: readonly (Omit<LinkRowInput, "date"> & { date?: string })[]): void {
  rewrite(join(folder, "project.md"), (text) => applyLinkRows(text, slug, links.map((link) => ({ ...link, date: link.date ?? localDate() }))));
}

export interface BrandRowInput {
  name: string;
  /** Addresses and domains, as written in the Receives at cell. */
  receivesAt: readonly string[];
  /** Signature lines; empty: not answered yet. */
  signature: readonly string[];
  /** Optional visible From name; absent keeps Mail's account name. */
  displayName?: string | null;
  by: By;
  date: string;
}

/** A Brands cell: `|` escaped, line breaks kept as `<br>` (a table cell is one line). */
const brandCell = (v: string): string => v.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|").trim();

/**
 * Sets one `## Brands` row (P60), replacing the row of that brand (case-insensitive) or adding it after the last row;
 * creates the section after `## Settings` when the file has none. The result is parsed again with the project's own
 * addresses and domains, and a Brands error (an address that is not the project's, one claimed by two rows) throws
 * ProjectError: nothing is written.
 */
export function applyBrandRow(text: string, slug: string, b: BrandRowInput): string {
  const bad: Issue[] = [];
  if (!b.name.trim()) bad.push({ severity: "error", code: "bad_value", line: null, field: "brands", message: "a brand needs a name" });
  if (!isIsoDate(b.date)) bad.push({ severity: "error", code: "bad_date", line: null, field: "brands", message: `"${b.date}" is not an ISO date` });
  if (!(BYS as readonly string[]).includes(b.by)) bad.push({ severity: "error", code: "bad_by", line: null, field: "brands", message: `By "${b.by}" must be one of ${BYS.join(", ")}` });
  if (bad.length) throw new ProjectError(bad);

  const raws = rawLines(text);
  const lines = raws.map(bare);
  const sc = scan(lines);
  const eol = eolOf(raws.find((r) => r.endsWith("\n")), "\n");
  const displayName = normalizedDisplayName(b.displayName);
  const row = (withDisplayName: boolean) => `| ${brandCell(b.name)} | ${brandCell(b.receivesAt.join(", "))} | ${brandCell(joinSignature(b.signature))} | ${b.date} | ${b.by} |${withDisplayName ? ` ${brandCell(displayName ?? "")} |` : ""}`;
  const section = sc.sections.find((s) => s.name === "brands");
  let next: string;
  if (!section) {
    const settings = sc.sections.find((s) => s.name === "settings");
    const after = settings ? sc.sections[sc.sections.indexOf(settings) + 1] : sc.sections.find((s) => s.name === "notion databases");
    const at = after ? after.start : raws.length;
    const lead = !after && raws.length && (lines[lines.length - 1] ?? "").trim() !== "" ? [eol] : [];
    next = insertAt(raws, at, [...lead, `## Brands${eol}`, eol, `${BRANDS_HEADER}${eol}`, `|---|---|---|---|---|---|${eol}`, `${row(true)}${eol}`, eol]);
  } else {
    const t = tableOf(lines, sc.fenced, section);
    let withDisplayName = t.header?.length === 6;
    if (!withDisplayName && displayName !== null && t.header?.length === 5) {
      raws[t.headerIdx] = `${BRANDS_HEADER}${eolOf(raws[t.headerIdx], eol)}`;
      if (raws[t.headerIdx + 1] !== undefined) raws[t.headerIdx + 1] = `|---|---|---|---|---|---|${eolOf(raws[t.headerIdx + 1], eol)}`;
      for (const r of t.rows) raws[r.idx] = `${bare(raws[r.idx] ?? "")} |${eolOf(raws[r.idx], eol)}`;
      withDisplayName = true;
    }
    const existing = t.rows.find((r) => (r.cells[0] ?? "").toLowerCase() === b.name.trim().toLowerCase());
    if (t.header === null) next = insertAt(raws, section.start + 1, [eol, `${BRANDS_HEADER}${eol}`, `|---|---|---|---|---|---|${eol}`, `${row(true)}${eol}`]);
    else if (existing) {
      raws[existing.idx] = `${row(withDisplayName)}${eolOf(raws[existing.idx], "")}`;
      next = raws.join("");
    } else next = insertAt(raws, t.lastIdx + 1, [`${row(withDisplayName)}${eol}`]);
  }
  const brandErrors = parseProjectMd(next, slug).issues.filter((i) => i.field === "brands" && i.severity === "error");
  if (brandErrors.length) throw new ProjectError(brandErrors);
  return next;
}

/** `folder` is <projects>/<slug>. */
export function writeBrandRow(folder: string, slug: string, b: Omit<BrandRowInput, "date"> & { date?: string }): void {
  rewrite(join(folder, "project.md"), (t) => applyBrandRow(t, slug, { ...b, date: b.date ?? localDate() }));
}

/**
 * P145 B2: one `- <slug>: <id>` item at the end of `## Notion databases` (the section is made at the end when missing), every other
 * byte kept. A slug already listed is left as it is: the installer adds a database it created, it never moves one.
 */
export function applyDatabaseEntry(text: string, slug: string, dataSourceId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug) || !UUID.test(dataSourceId)) throw new ProjectError([{ severity: "error", code: "bad_value", line: null, field: slug, message: `"${slug}: ${dataSourceId}" is not a database slug and data source id` }]);
  if (extractDatabases(text).databases.some((d) => d.slug === slug)) return text;
  const lines = rawLines(text);
  const plain = lines.map(bare);
  const section = findSection(scan(plain), SECTIONS.databases);
  const eol = eolOf(lines[0], "\n");
  const item = `- ${slug}: ${normalizeId(dataSourceId)}`;
  if (!section) return `${text}${text.endsWith("\n") ? "" : eol}${eol}## Notion databases${eol}${eol}${item}${eol}`;
  let last = section.start;
  for (let i = section.start + 1; i < section.end; i++) if (/^\s*[-*]\s+\S/.test(plain[i] ?? "")) last = i;
  const at = last === section.start ? section.start + 1 : last + 1;
  const before = lines.slice(0, at).join("");
  const sep = before.endsWith("\n") ? "" : eol;
  return `${before}${sep}${last === section.start ? eol : ""}${item}${eol}${lines.slice(at).join("")}`;
}

/** `folder` is <projects>/<slug>. */
export function writeDatabaseEntry(folder: string, slug: string, dataSourceId: string): void {
  rewrite(join(folder, "project.md"), (t) => applyDatabaseEntry(t, slug, dataSourceId));
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
