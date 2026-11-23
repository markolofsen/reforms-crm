// project.md schema v1 (doc 16 section 3). Pure: text in, structure and issues out. No file or database access, so
// @hub/notion can import this file alone.
import { parseBrands } from "./brand";
import { checkValue, FIELDS, isPolicyField, readField, setPath } from "./fields";
import { DEFAULT_KIND, kindOf, requiredIssues } from "./kinds";
import { hasErrors, ProjectError, type Issue } from "./md/issues";
import { findSection, readTable, SECTIONS } from "./md/sections";
import { scan, splitLines } from "./md/scan";
import { BYS, ProjectBase, STATUSES, type By, type ProjectConfig, type ProjectDatabase, type ProjectLink, type ProjectStatus } from "./schema";
import { EMAIL, isIsoDate, normalizeAddress, normalizeId, SLUG, UUID } from "./values";

export const SCHEMA_VERSION = 1;

export { BYS, STATUSES, checkValue, FIELDS, isIsoDate, normalizeAddress, normalizeId };
export type { By, ProjectConfig, ProjectDatabase, ProjectLink, ProjectStatus };
export type { KnowledgeSource } from "./schema";

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
  name: string;
  summary: string;
  settings: Record<string, SettingRow>;
  databases: ProjectDatabase[];
  links: ProjectLink[];
  answers: AnswerRow[];
  issues: Issue[];
  /** Missing required fields were found (an error for active/paused projects, a warning for drafts). */
  incomplete: boolean;
  /** Resolved values with defaults. Always present; meaningful when `issues` has no error. `send` and `draft` are the safe defaults here: the send policy file supplies them (`loadProjects` with `policyDir`). */
  config: ProjectConfig;
  /** Rows of the send-policy fields still in project.md (P49 S11): ignored, reported, moved by `hub send policy migrate`. */
  policyRows: Record<string, SettingRow>;
}

const ITEM = /^\s*[-*]\s+([a-z0-9][a-z0-9_-]*)\s*:\s*(\S+)/;

// ---- parsing ----------------------------------------------------------------------------------------------------

/**
 * The `## Notion databases` list and the display name. Only the items under `## Notion databases` are databases;
 * any other `- key: value` item is an error.
 */
export function extractDatabases(text: string): { name: string | null; databases: ProjectDatabase[]; issues: Issue[] } {
  const lines = splitLines(text);
  const sc = scan(lines);
  const dbSection = findSection(sc, SECTIONS.databases);
  const issues: Issue[] = [];
  const databases: ProjectDatabase[] = [];
  const seen = new Set<string>();

  lines.forEach((line, i) => {
    if (sc.fenced[i]) return;
    const item = ITEM.exec(line);
    if (!item) return;
    const [, slug, rawId] = item as unknown as [string, string, string];
    const inDb = (dbSection !== undefined && i > dbSection.start && i < dbSection.end);
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
  return { name: sc.title, databases, issues };
}

const LINK_ID = /^[0-9a-f]{32}$/i;
const LINK_ID_WITH_DASHES = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const compactNotionId = (value: string): string => value.replace(/-/g, "").toLowerCase();

const notionIdFromUrl = (url: URL): string | null => {
  if (!/(^|\.)notion\.(so|site)$/i.test(url.hostname)) return null;
  const match = /([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{32})(?:$|[-/])/i.exec(url.pathname);
  return match?.[1] ? compactNotionId(match[1]) : null;
};

/** Normalizes a declared Quick Link and rejects non-https or unknown Notion targets. */
export function normalizeProjectLinkTarget(raw: string, databases: readonly ProjectDatabase[]): string | null {
  const value = raw.trim();
  if (/^notion:/i.test(value)) {
    const reference = value.slice("notion:".length).trim().toLowerCase();
    if (LINK_ID.test(reference) || LINK_ID_WITH_DASHES.test(reference)) return `notion:${compactNotionId(reference)}`;
    if (SLUG.test(reference) && databases.some((database) => database.slug.toLowerCase() === reference)) return `notion:${reference}`;
    return null;
  }
  if (!/^https:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const notionId = notionIdFromUrl(url);
    return notionId ? `notion:${notionId}` : url.href;
  } catch {
    return null;
  }
}

/** Parses the optional `## Links` table. A missing section is deliberately valid for legacy projects. */
export function extractLinks(text: string, databases: readonly ProjectDatabase[]): { links: ProjectLink[]; issues: Issue[] } {
  const lines = splitLines(text);
  const sc = scan(lines);
  const table = readTable(lines, sc, SECTIONS.links);
  if (!table) return { links: [], issues: [] };

  const issues: Issue[] = [...table.issues];
  const candidates: Array<ProjectLink & { valid: boolean; line: number }> = [];
  const seen = new Map<string, number>();
  const addIssue = (line: number, message: string, field = "links") => issues.push({ severity: "error", code: "bad_link", line, field, message });

  for (const row of table.rows) {
    const line = row.line;
    const [group = "", label = "", rawTarget = "", rawUnder = "", answered = "", by = ""] = row.cells;
    let valid = true;
    const normalizedGroup = group.trim();
    const normalizedLabel = label.trim();
    const under = rawUnder.trim() || null;
    if (!normalizedGroup || normalizedGroup.length > 120) {
      addIssue(line, "a link needs a Group between 1 and 120 characters");
      valid = false;
    }
    if (!normalizedLabel || normalizedLabel.length > 120) {
      addIssue(line, "a link needs a Label between 1 and 120 characters");
      valid = false;
    }
    const target = normalizeProjectLinkTarget(rawTarget, databases);
    if (!target) {
      addIssue(line, `Target "${rawTarget}" must be notion:<database role>, notion:<32 hex id>, or an https URL`);
      valid = false;
    }
    if (!isIsoDate(answered)) {
      addIssue(line, `Answered "${answered}" is not an ISO date (YYYY-MM-DD)`);
      valid = false;
    }
    if (!(BYS as readonly string[]).includes(by)) {
      addIssue(line, `By "${by}" must be one of ${BYS.join(", ")}`);
      valid = false;
    }
    const key = `${normalizedGroup.toLowerCase()}\u0000${normalizedLabel.toLowerCase()}`;
    if (seen.has(key)) {
      addIssue(line, `link "${normalizedLabel}" in group "${normalizedGroup}" is listed twice (first on line ${seen.get(key)})`);
      valid = false;
    } else if (normalizedGroup && normalizedLabel) {
      seen.set(key, line);
    }
    if (valid) candidates.push({ group: normalizedGroup, label: normalizedLabel, target: target as string, under, answered, by: by as By, valid, line });
  }

  const byKey = new Map(candidates.map((candidate) => [`${candidate.group.toLowerCase()}\u0000${candidate.label.toLowerCase()}`, candidate]));
  for (const candidate of candidates) {
    if (!candidate.under) continue;
    const parent = byKey.get(`${candidate.group.toLowerCase()}\u0000${candidate.under.toLowerCase()}`);
    if (!parent) {
      addIssue(candidate.line, `Under "${candidate.under}" does not name another link in group "${candidate.group}"`);
      candidate.valid = false;
      continue;
    }
    if (parent.label.toLowerCase() === candidate.label.toLowerCase()) {
      addIssue(candidate.line, "a link cannot be nested under itself");
      candidate.valid = false;
      continue;
    }
    if (parent.under) {
      addIssue(candidate.line, `Under "${candidate.under}" is already nested; Links supports one level of nesting`);
      candidate.valid = false;
    }
  }

  return {
    links: candidates.filter((candidate) => candidate.valid).map((candidate) => ({ group: candidate.group, label: candidate.label, target: candidate.target, under: candidate.under, answered: candidate.answered, by: candidate.by })),
    issues,
  };
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
  const policyRows: Record<string, SettingRow> = {};
  const answers: AnswerRow[] = [];

  if (!SLUG.test(slug)) {
    issues.push({ severity: "error", code: "bad_slug", line: null, message: `folder name "${slug}" must match [a-z0-9-]+` });
  }

  const dbs = extractDatabases(text);
  issues.push(...dbs.issues);
  const parsedLinks = extractLinks(text, dbs.databases);
  issues.push(...parsedLinks.issues);

  const settingsTable = readTable(lines, sc, SECTIONS.settings);
  const answersTable = readTable(lines, sc, SECTIONS.answers);
  const settingsSection = settingsTable?.section;

  // summary: prose between the title and the first section
  const firstSection = sc.sections[0]?.start ?? lines.length;
  const summary = lines
    .slice(sc.titleLine + 1, firstSection)
    .filter((l) => l.trim() !== "")
    .join(" ")
    .trim();

  if (settingsTable) {
    issues.push(...settingsTable.issues);
    for (const r of settingsTable.rows) {
      const line = r.line;
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
      // P49 S11: the send policy is server-owned; a row here is the old place (or an agent's edit) and is never applied.
      if (isPolicyField(field)) {
        policyRows[field] = { field, value, answered, by: by as By, line };
        issues.push({ severity: "warning", code: "send_policy_in_project_md", line, field, message: `${field} is ignored here: the send policy lives in state/projects/${slug}/send-policy.json (a person runs \`hub send policy migrate ${slug}\`)` });
        continue;
      }
      settings[field] = { field, value, answered, by: by as By, line };
    }
  }

  if (answersTable) {
    issues.push(...answersTable.issues);
    for (const r of answersTable.rows) {
      const line = r.line;
      const [date, field, question, answer] = r.cells as [string, string, string, string];
      if (!isIsoDate(date)) issues.push({ severity: "error", code: "bad_date", line, message: `Answers date "${date}" is not an ISO date` });
      answers.push({ date, field, question, answer, line });
    }
  }

  // Schema 1 is the only format: a project.md without `## Settings` is not a project the hub can read.
  if (!settingsSection) {
    issues.push({ severity: "error", code: "schema_required", line: null, field: "schema", message: "schema 1 required: this project.md has no ## Settings table; run the project-setup skill" });
  }
  const get = (f: string): string | undefined => settings[f]?.value;

  // schema version: an unknown one stops further interpretation (the other rules may have changed)
  if (settingsSection) {
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
  // P60: `## Brands`, read against the resolved addresses, aliases and domains.
  const brandsTable = readTable(lines, sc, SECTIONS.brands);
  let brands: ReturnType<typeof parseBrands>["brands"] = [];
  if (brandsTable) {
    issues.push(...brandsTable.issues);
    const own = { accounts, addresses: mail.addresses, domains: (mail.domains as string[] | undefined) ?? [] };
    const b = parseBrands(brandsTable.rows, own);
    brands = b.brands;
    issues.push(...b.issues);
  }
  const config = ProjectBase.parse({
    ...raw,
    brands,
    links: parsedLinks.links,
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
  // P62: a calendar connector needs the calendar module (a support kind has none): kept out of every session, said here.
  if (config.calendar.connector.length && !config.modules.includes("calendar")) {
    issues.push({ severity: "warning", code: "bad_value", line: settings["calendar.connector"]?.line ?? null, field: "calendar.connector", message: `calendar.connector is not used: kind ${kind.id} has no calendar module` });
  }

  // required fields (only for a file with Settings). `schema` is structural; the rest is the kind's list.
  let incomplete = false;
  if (settingsSection && !issues.some((i) => i.code === "unknown_schema")) {
    const required = requiredIssues(config, kind, Boolean(get("schema")));
    incomplete = required.length > 0;
    issues.push(...required);
    if (status === "active" && config.setup.doctor && !/ pass$/.test(config.setup.doctor)) {
      issues.push({ severity: "warning", code: "bad_value", line: settings["setup.doctor"]?.line ?? null, field: "setup.doctor", message: "status is active but the last doctor result is not a pass" });
    }
  }

  return { slug, name: config.name, summary, settings, databases: dbs.databases, links: parsedLinks.links, answers, issues, incomplete, config, policyRows };
}

/** parseProjectMd, throwing a ProjectError when there is an error-level issue. */
export function readProject(text: string, slug: string): ParsedProject {
  const p = parseProjectMd(text, slug);
  if (hasErrors(p.issues)) throw new ProjectError(p.issues);
  return p;
}
