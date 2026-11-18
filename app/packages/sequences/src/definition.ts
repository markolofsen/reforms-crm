// A sequence definition: one file `projects/<slug>/sequences/<id>.md`, owned by the project (decision 0017, like workflows).
// This module is pure: it parses a text and reports every problem it finds; `load.ts` is the one place that reads files.
//
// Front matter: name, description ("Use when ..."), status (Draft, Active, Retired), applies_to (["Lead", "Client"]),
// mail_classes, languages, business_days (default true), enrol_after_days (default 2), max_words (default 90), stop_on (the core
// minimum always applies: a file may add a reason, never remove one).
// Body: Goal; Steps (a table `# | after (days) | purpose | adds | knowledge topics`); Last step; Do not; Opt-out line.
// `after` counts days after OUR previous message (the anchor moves with every sent step), not after the first one.

export const SEQUENCE_STATUSES = ["Draft", "Active", "Retired"] as const;
export type SequenceStatus = (typeof SEQUENCE_STATUSES)[number];
export const APPLIES_TO = ["Lead", "Client"] as const;
export type AppliesTo = (typeof APPLIES_TO)[number];

/** The stop reasons every sequence has. A file that lists `stop_on` without one of them is an error (a stop removed). */
export const CORE_STOP_ON = ["replied", "bounced", "opted_out", "closed", "excluded"] as const;
/** What a file may add: `out_of_office` makes an auto-reply finish the enrollment instead of moving the next step. */
export const EXTRA_STOP_ON = ["out_of_office"] as const;
export type StopOn = (typeof CORE_STOP_ON)[number] | (typeof EXTRA_STOP_ON)[number];
const ALL_STOP_ON: readonly string[] = [...CORE_STOP_ON, ...EXTRA_STOP_ON];

export const REQUIRED_SECTIONS = ["Goal", "Steps"] as const;
export const RECOMMENDED_SECTIONS = ["Last step", "Do not"] as const;
/** The longest wait one step may ask for, in days: a longer gap is nurture, which this track leaves out. */
export const MAX_DELAY_DAYS = 60;
/** How long a step draft may be when the file says nothing (`max_words`). A project sets its own, e.g. a longer personal note. */
export const DEFAULT_MAX_WORDS = 90;
/** The range `max_words` accepts: below it a step cannot carry its fact and the opt-out line, above it it is a newsletter. */
export const MIN_MAX_WORDS = 30;
export const MAX_MAX_WORDS = 400;

export interface SequenceIssue {
  severity: "error" | "warning";
  message: string;
}

export interface SequenceStep {
  n: number;
  /** Days after our previous message (business days unless the file says `business_days: false`). */
  after: number;
  purpose: string;
  /** The value this touch adds: a new fact, option or answer. */
  adds: string;
  /** `knowledge_search` topics for this step. */
  topics: string[];
}

export interface SequenceDefinition {
  /** File name without `.md`: the id an enrollment stores. */
  id: string;
  file: string;
  name: string;
  description: string;
  status: SequenceStatus | null;
  appliesTo: AppliesTo[];
  mailClasses: string[];
  languages: string[];
  businessDays: boolean;
  enrolAfterDays: number;
  /** The most words a step draft may have (`max_words`, default 90): the `sequence-drafts` skill keeps every step under it. */
  maxWords: number;
  stopOn: StopOn[];
  steps: SequenceStep[];
  goal: string;
  lastStep: string;
  doNot: string;
  optOut: string;
  issues: SequenceIssue[];
}

/** What an enrollment keeps of its sequence: the waits and how they count. An edited file applies to new enrolments only. */
export type Schedule = { delays: number[]; businessDays: boolean };
export const scheduleOf = (d: Pick<SequenceDefinition, "steps" | "businessDays">): Schedule => ({ delays: d.steps.map((s) => s.after), businessDays: d.businessDays });

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(t);
      return typeof parsed === "string" ? parsed : t.slice(1, -1);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

function frontMatter(text: string): { fields: Map<string, string>; body: string } | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const fields = new Map<string, string>();
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(l);
    if (m?.[1] !== undefined && m[2] !== undefined) fields.set(m[1], m[2]);
  }
  return { fields, body: lines.slice(end + 1).join("\n") };
}

/** A JSON list of strings; `undefined` raw is an empty list, anything else that is not one is null (an error). */
function listOf(raw: string | undefined): string[] | null {
  if (raw === undefined || raw.trim() === "") return [];
  try {
    const v: unknown = JSON.parse(raw.trim());
    return Array.isArray(v) && v.every((x): x is string => typeof x === "string") ? v : null;
  } catch {
    return null;
  }
}

/** The level-2 or level-3 sections outside code fences, with their text. */
function sectionsOf(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let fenced = false;
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) out.set(current.toLowerCase(), buf.join("\n").trim());
  };
  for (const l of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    const m = fenced ? null : /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(l);
    if (m?.[1] !== undefined) {
      flush();
      current = m[1];
      buf = [];
    } else buf.push(l);
  }
  flush();
  return out;
}

const cells = (row: string): string[] => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** The rows of the Steps table. Every problem is an issue; a row that cannot be read is left out. */
function stepsOf(text: string, err: (m: string) => void): SequenceStep[] {
  const rows = text.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  const data = rows.slice(1).filter((r) => !/^\|?\s*:?-{3,}/.test(r.trim()));
  if (rows.length === 0 || data.length === 0) {
    err('section "Steps" has no table rows (`| # | after (days) | purpose | adds | knowledge topics |`)');
    return [];
  }
  const out: SequenceStep[] = [];
  for (const [i, row] of data.entries()) {
    const c = cells(row);
    const [n, after, purpose = "", adds = "", topics = ""] = c;
    const at = `Steps row ${i + 1}`;
    if (c.length < 4) {
      err(`${at}: needs at least 4 cells (#, after, purpose, adds), has ${c.length}`);
      continue;
    }
    if (!/^\d+$/.test(n ?? "") || Number(n) !== i + 1) err(`${at}: the step number must be ${i + 1}, found "${n ?? ""}"`);
    if (!/^\d+$/.test(after ?? "") || Number(after) < 1 || Number(after) > MAX_DELAY_DAYS) {
      err(`${at}: after "${after ?? ""}" is not a whole number of days from 1 to ${MAX_DELAY_DAYS}`);
      continue;
    }
    if (!purpose) err(`${at}: purpose is empty`);
    if (!adds) err(`${at}: "adds" is empty (each follow-up must add something new: a fact, an option, an answer)`);
    out.push({ n: i + 1, after: Number(after), purpose, adds, topics: topics.split(",").map((t) => t.trim()).filter(Boolean) });
  }
  return out;
}

/** Parses one sequence file. Never throws: every problem is an issue, and a file with an error is never offered for enrolment. */
export function parseSequence(text: string, file: string): SequenceDefinition {
  const id = file.replace(/^.*[\\/]/, "").replace(/\.md$/i, "");
  const issues: SequenceIssue[] = [];
  const err = (message: string) => issues.push({ severity: "error", message });
  const warn = (message: string) => issues.push({ severity: "warning", message });
  const empty: SequenceDefinition = { id, file, name: id, description: "", status: null, appliesTo: [], mailClasses: [], languages: [], businessDays: true, enrolAfterDays: 2, maxWords: DEFAULT_MAX_WORDS, stopOn: [...CORE_STOP_ON], steps: [], goal: "", lastStep: "", doNot: "", optOut: "", issues };
  const fm = frontMatter(text);
  if (!fm) {
    err("no front matter (a block between two `---` lines at the top)");
    return empty;
  }
  const f = fm.fields;
  const name = unquote(f.get("name") ?? "");
  if (!name) err("front matter has no `name`");
  const description = unquote(f.get("description") ?? "");
  if (!description) err("front matter has no `description`");
  else if (!/^use when\b/i.test(description)) warn('description should start with "Use when ..."');

  const statusRaw = unquote(f.get("status") ?? "");
  const status = SEQUENCE_STATUSES.find((s) => s === statusRaw) ?? null;
  if (!status) err(`status "${statusRaw}" is not one of ${SEQUENCE_STATUSES.join(", ")}`);

  const appliesRaw = listOf(f.get("applies_to"));
  const appliesTo = (appliesRaw ?? []).flatMap((a) => APPLIES_TO.filter((x) => x === a));
  if (appliesRaw === null || appliesRaw.length === 0) err('applies_to must be a JSON list such as ["Lead", "Client"]');
  else for (const a of appliesRaw) if (!APPLIES_TO.some((x) => x === a)) err(`applies_to "${a}" is not one of ${APPLIES_TO.join(", ")}`);

  const mailClasses = listOf(f.get("mail_classes"));
  if (mailClasses === null) err('mail_classes must be a JSON list such as ["client"]');
  const languages = listOf(f.get("languages"));
  if (languages === null) err('languages must be a JSON list such as ["en", "fr"]');

  const bdRaw = unquote(f.get("business_days") ?? "true").toLowerCase();
  if (bdRaw !== "true" && bdRaw !== "false") err(`business_days "${bdRaw}" is not true or false`);
  const afterRaw = unquote(f.get("enrol_after_days") ?? "2");
  const enrolAfterDays = /^\d+$/.test(afterRaw) && Number(afterRaw) <= MAX_DELAY_DAYS ? Number(afterRaw) : 2;
  if (!/^\d+$/.test(afterRaw) || Number(afterRaw) > MAX_DELAY_DAYS) err(`enrol_after_days "${afterRaw}" is not a whole number of days from 0 to ${MAX_DELAY_DAYS}`);

  const wordsRaw = unquote(f.get("max_words") ?? String(DEFAULT_MAX_WORDS));
  const wordsOk = /^\d+$/.test(wordsRaw) && Number(wordsRaw) >= MIN_MAX_WORDS && Number(wordsRaw) <= MAX_MAX_WORDS;
  if (!wordsOk) err(`max_words "${wordsRaw}" is not a whole number of words from ${MIN_MAX_WORDS} to ${MAX_MAX_WORDS}`);
  const maxWords = wordsOk ? Number(wordsRaw) : DEFAULT_MAX_WORDS;

  const stopRaw = f.has("stop_on") ? listOf(f.get("stop_on")) : [...CORE_STOP_ON];
  if (stopRaw === null) err('stop_on must be a JSON list such as ["replied", "bounced"]');
  for (const s of stopRaw ?? []) if (!ALL_STOP_ON.includes(s)) err(`stop_on "${s}" is not a stop reason (${ALL_STOP_ON.join(", ")})`);
  for (const s of CORE_STOP_ON) if (stopRaw && !stopRaw.includes(s)) err(`stop_on leaves out "${s}": a file may add a stop reason, never remove one of the core's`);
  const stopOn = [...new Set([...CORE_STOP_ON, ...(stopRaw ?? []).flatMap((s) => EXTRA_STOP_ON.filter((x) => x === s))])];

  const sections = sectionsOf(fm.body);
  const sec = (k: string) => sections.get(k.toLowerCase());
  for (const s of REQUIRED_SECTIONS) if (sec(s) === undefined) err(`missing section "${s}"`);
  for (const s of RECOMMENDED_SECTIONS) if (sec(s) === undefined) warn(`missing section "${s}"`);
  const steps = sec("Steps") === undefined ? [] : stepsOf(sec("Steps") ?? "", err);
  const optOut = sec("Opt-out line") ?? "";
  if (steps.length >= 2 && !optOut) err('missing section "Opt-out line": steps 2 and later carry one plain opt-out sentence');

  return {
    id,
    file,
    name: name || id,
    description,
    status,
    appliesTo,
    mailClasses: mailClasses ?? [],
    languages: languages ?? [],
    businessDays: bdRaw !== "false",
    enrolAfterDays,
    maxWords,
    stopOn,
    steps,
    goal: sec("Goal") ?? "",
    lastStep: sec("Last step") ?? "",
    doNot: sec("Do not") ?? "",
    optOut,
    issues,
  };
}

export const sequenceErrors = (all: readonly SequenceDefinition[]): number => all.reduce((n, d) => n + d.issues.filter((i) => i.severity === "error").length, 0);

/** A sequence the owner may enrol a client in: not Retired and without an error. Draft ones are offered too (the owner reviews by using them on test addresses). */
export const isUsable = (d: SequenceDefinition): boolean => d.status !== null && d.status !== "Retired" && d.steps.length > 0 && !d.issues.some((i) => i.severity === "error");

/**
 * The sequence a candidate is offered first: usable, its `applies_to` holds the client's kind of page (a lead page is a Lead,
 * a client row a Client; no page fits either) and its `mail_classes` holds the draft's class (an empty list fits any).
 * Active before Draft, then file order. Null when none fits.
 */
export function pickSequence<T extends SequenceDefinition>(all: readonly T[], c: { mailClass: string | null; notionKind: "client" | "lead" | "none" | null }): T | null {
  const kind: AppliesTo | null = c.notionKind === "lead" ? "Lead" : c.notionKind === "client" ? "Client" : null;
  const fits = all.filter((d) => isUsable(d) && (kind === null || d.appliesTo.includes(kind)) && (d.mailClasses.length === 0 || (c.mailClass !== null && d.mailClasses.includes(c.mailClass))));
  return fits.find((d) => d.status === "Active") ?? fits[0] ?? null;
}
