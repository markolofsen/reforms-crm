// `<instance>/projects/<slug>/mail-filters.md`: the rules file. Parser and writer. Pure: text in, structure and issues out.
import { findColor, GMAIL_PALETTE } from "./colors.js";
import { checkMatchValue, parseMatch } from "./match.js";
import {
  ACTIONS,
  classesOf,
  classIds,
  MATCH_KINDS,
  matchText,
  type Action,
  type By,
  type Category,
  type Issue,
  type MailClass,
  type IssueCode,
  type Rule,
  type RulesFile,
  type WhitelistEntry,
} from "./model.js";

const FORBIDDEN_ACTIONS = new Set(["delete", "trash", "forward", "spam", "mark-spam", "archive", "never-spam-off"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const catIndex = (classes: readonly MailClass[], c: Category) => classIds(classes).indexOf(c);
const kindIndex = (k: string) => MATCH_KINDS.indexOf(k as never);

export function compareRules(a: Rule, b: Rule, classes: readonly MailClass[] = classesOf({})): number {
  return (
    catIndex(classes, a.category) - catIndex(classes, b.category) ||
    kindIndex(a.match.kind) - kindIndex(b.match.kind) ||
    (a.match.value < b.match.value ? -1 : a.match.value > b.match.value ? 1 : 0)
  );
}

const compareWhitelist = (a: WhitelistEntry, b: WhitelistEntry): number =>
  kindIndex(a.match.kind) - kindIndex(b.match.kind) || (a.match.value < b.match.value ? -1 : a.match.value > b.match.value ? 1 : 0);

/** Drops exact duplicates (same match and category; the earliest date wins) and sorts. Idempotent. */
export function normalizeRules(file: RulesFile): RulesFile {
  const rules = new Map<string, Rule>();
  for (const r of file.rules) {
    const k = `${matchText(r.match)}|${r.category}`;
    const prev = rules.get(k);
    if (!prev || r.date < prev.date) rules.set(k, r);
  }
  const wl = new Map<string, WhitelistEntry>();
  for (const w of file.whitelist) {
    const k = matchText(w.match);
    const prev = wl.get(k);
    if (!prev || w.date < prev.date) wl.set(k, w);
  }
  return { rules: [...rules.values()].sort((a, b) => compareRules(a, b, classesOf(file))), whitelist: [...wl.values()].sort(compareWhitelist), notes: file.notes, ...(file.colors && Object.keys(file.colors).length ? { colors: file.colors } : {}), ...(file.classes ? { classes: file.classes } : {}) };
}

// ---- table helpers ------------------------------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i] as string;
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isSeparator = (line: string): boolean => /^\s*\|?\s*:?-{3,}/.test(line);

interface Section {
  name: string;
  /** Lines with their 1-based numbers. */
  lines: { n: number; text: string }[];
}

function sections(text: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  text.split("\n").forEach((line, i) => {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      cur = { name: (h[1] as string).toLowerCase(), lines: [] };
      out.push(cur);
    } else if (cur) cur.lines.push({ n: i + 1, text: line });
  });
  return out;
}

function tableRows(sec: Section | undefined): { n: number; cells: string[] }[] {
  if (!sec) return [];
  const rows = sec.lines.filter((l) => l.text.trim().startsWith("|"));
  return rows.filter((l) => !isSeparator(l.text)).slice(1).map((l) => ({ n: l.n, cells: splitRow(l.text) }));
}

// ---- parse --------------------------------------------------------------------------------------------------------

export interface ParsedRules {
  file: RulesFile;
  /** Row-level problems found while reading. Rows that fail are left out of `file`. */
  issues: Issue[];
}

export function parseRulesFile(text: string, classes?: readonly MailClass[]): ParsedRules {
  const issues: Issue[] = [];
  const bad = (code: IssueCode, line: number, message: string) => issues.push({ severity: "error", code, line, message });
  const secs = sections(text);
  const file: RulesFile = { rules: [], whitelist: [], notes: "", ...(classes ? { classes } : {}) };
  const ids = classIds(classesOf(file));

  for (const row of tableRows(secs.find((s) => s.name.startsWith("rules")))) {
    const [matchCell = "", category = "", label = "", action = "", why = "", date = "", by = ""] = row.cells;
    if (row.cells.length !== 7) {
      bad("bad_table", row.n, `a rule row needs 7 cells (match, category, label, action, why, date, by), found ${row.cells.length}`);
      continue;
    }
    const m = parseMatch(matchCell);
    if ("error" in m) {
      bad("bad_match", row.n, m.error);
      continue;
    }
    if (!ids.includes(category)) {
      bad("bad_category", row.n, `unknown category "${category}" (this project's kind has: ${ids.join(", ")})`);
      continue;
    }
    if (FORBIDDEN_ACTIONS.has(action)) {
      bad("forbidden_action", row.n, `action "${action}" does not exist here: filters only label, or label and skip the inbox and mark read`);
      continue;
    }
    if (!(ACTIONS as readonly string[]).includes(action)) {
      bad("bad_action", row.n, `unknown action "${action}" (expected ${ACTIONS.join(" or ")})`);
      continue;
    }
    if (!ISO.test(date)) {
      bad("bad_date", row.n, `"${date}" is not an ISO date`);
      continue;
    }
    if (by !== "agent" && by !== "owner") {
      bad("bad_by", row.n, `"${by}" is not agent or owner`);
      continue;
    }
    file.rules.push({ match: m.match, category: category as Category, label, action: action as Action, why, date, by: by as By });
  }

  for (const row of tableRows(secs.find((s) => s.name.startsWith("client whitelist")))) {
    const [matchCell = "", why = "", date = "", by = ""] = row.cells;
    if (row.cells.length !== 4) {
      bad("bad_table", row.n, `a whitelist row needs 4 cells (match, why, date, by), found ${row.cells.length}`);
      continue;
    }
    const m = parseMatch(matchCell);
    if ("error" in m || (m.match.kind !== "from" && m.match.kind !== "domain")) {
      bad("bad_whitelist", row.n, "error" in m ? m.error : "a whitelist entry is from:<address> or domain:<domain>");
      continue;
    }
    if (!ISO.test(date)) {
      bad("bad_date", row.n, `"${date}" is not an ISO date`);
      continue;
    }
    if (by !== "agent" && by !== "owner") {
      bad("bad_by", row.n, `"${by}" is not agent or owner`);
      continue;
    }
    file.whitelist.push({ match: m.match as WhitelistEntry["match"], why, date, by: by as By });
  }

  for (const row of tableRows(secs.find((s) => s.name.startsWith("label colors")))) {
    const [cls = "", colorName = ""] = row.cells;
    if (row.cells.length < 2) {
      bad("bad_table", row.n, "a color row needs 2 cells (class, color)");
      continue;
    }
    if (!ids.includes(cls)) {
      bad("bad_color_class", row.n, `unknown class "${cls}" (expected ${ids.join(", ")})`);
      continue;
    }
    const color = findColor(colorName);
    if (!color) {
      bad("bad_color", row.n, `"${colorName}" is not in the Gmail palette (${GMAIL_PALETTE.map((c) => c.name).join(", ")})`);
      continue;
    }
    file.colors = { ...file.colors, [cls]: color.name };
  }

  const notes = secs.find((s) => s.name === "notes");
  file.notes = notes ? notes.lines.map((l) => l.text).join("\n").trim() : "";
  return { file, issues };
}

// ---- write --------------------------------------------------------------------------------------------------------

export function writeRulesFile(input: RulesFile, slug: string): string {
  const file = normalizeRules(input);
  const lines: string[] = [
    `# Mail filters: ${slug}`,
    "",
    "Rules that classify this project's incoming mail by where it comes from. Source of truth for `pnpm hub mail-filters`.",
    "Match is `from:<address>`, `domain:<domain>`, `list-id:<id>` or `subject:<phrase>`. Action is `label` or `label+skip+read`",
    "(only service and marketing may skip the inbox). Nothing here deletes, forwards or marks spam. Edit through the skill, not by hand.",
    "",
    "## Rules",
    "",
    "| Match | Category | Label | Action | Why | Date | By |",
    "|---|---|---|---|---|---|---|",
    ...file.rules.map((r) => `| ${[matchText(r.match), r.category, r.label, r.action, r.why, r.date, r.by].map(esc).join(" | ")} |`),
    "",
    "## Client whitelist",
    "",
    "Always reach the inbox, always win over a rule above.",
    "",
    "| Match | Why | Date | By |",
    "|---|---|---|---|",
    ...file.whitelist.map((w) => `| ${[matchText(w.match), w.why, w.date, w.by].map(esc).join(" | ")} |`),
    "",
  ];
  const colorEntries = classIds(classesOf(file)).filter((c) => file.colors?.[c]);
  if (colorEntries.length) {
    lines.push(
      "## Label colors",
      "",
      "Overrides of the universal palette (`@docs/core/17-mail-filters.md`). Class is a category, color a Gmail palette name.",
      "",
      "| Class | Color |",
      "|---|---|",
      ...colorEntries.map((c) => `| ${c} | ${file.colors?.[c]} |`),
      "",
    );
  }
  lines.push("## Notes", "");
  if (file.notes) lines.push(file.notes, "");
  return lines.join("\n");
}

export { checkMatchValue };
