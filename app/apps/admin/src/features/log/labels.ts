import type { RunStatus } from "@hub/config";
import { ACTIVITY_OUTCOME_LABELS, type ActivityRowDto, type ActivitySessionDto } from "@hub/contract/activity";
import { formatTime, hhmm, plural, tokens, usd } from "@/lib/format";
import type { ActivityView, RunFilter } from "@/routes/search";

// The words of the Activity screen, as pure functions of the contract (a Vitest test sits beside this file).

export const RUN_FILTER_LABELS: Record<RunFilter, string> = { all: "All", needs_human: "Needs you", failed: "Failed", ok: "Done" };
export const RUN_FILTER_ORDER: readonly RunFilter[] = ["all", "needs_human", "failed", "ok"];
/** The View menu of Activity: the session views, then Sends (UX pass 2026-11-20), the send history. */
export const VIEW_LABELS: Record<ActivityView, string> = { ...RUN_FILTER_LABELS, sends: "Sends" };
export const VIEW_ORDER: readonly ActivityView[] = [...RUN_FILTER_ORDER, "sends"];

/** A session's standing, said only when it is not a plain finish, so "Done" is not repeated on every heading. */
const STATUS_NOTE: Record<RunStatus, string | null> = { ok: null, needs_human: "Needs you", failed: "Did not finish" };

/** A client decision, as opposed to a note (a thought, a tool step, an error). */
export const isDecision = (r: ActivityRowDto): boolean => r.outcome !== "other";

/** "16 Nov, 15:26 · triage-mail · 2 decisions", plus "Needs you" or "Did not finish" when the session ended so. */
export function sessionHeading(s: ActivitySessionDto): string {
  return [formatTime(s.startedAt), s.skill ?? "Session", plural(s.rows.filter(isDecision).length, "decision"), STATUS_NOTE[s.status]].filter(Boolean).join(" · ");
}

/** The detail's heading: when and which skill. The decision count is the table's, never said twice. */
export const sessionTitle = (s: ActivitySessionDto): string => `${formatTime(s.startedAt)} · ${s.skill ?? "Session"}`;

/**
 * The cells a row shows. A note has no client of its own: its text is the agent's words. A coded reason reads as its
 * phrase (`readReason` below), the agent's words after the code as `detail`.
 */
export function rowCells(r: ActivityRowDto): { who: string; what: string; why: string; detail: string | null } {
  const { why, detail } = reasonParts(r);
  return { who: isDecision(r) ? (r.client?.name ?? r.who) : (r.client?.name ?? ""), what: ACTIVITY_OUTCOME_LABELS[r.outcome], why, detail };
}

const asSentence = (t: string): string => {
  const s = t.trim();
  return s === "" ? "" : `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}`;
};

/** "Marta Gomes: escalated. Asks about a discount." or "Note: Updated 3 client profiles in Notion." The detail is not in it. */
export function rowSentence(r: ActivityRowDto): string {
  const { who, what, why } = rowCells(r);
  if (!isDecision(r)) return `${what}: ${asSentence(why)}`;
  return [`${who}: ${what.toLowerCase()}.`, asSentence(why)].filter(Boolean).join(" ");
}

/** "1m 30s", "45s", "2m". Called only with a positive number, so it never reads "0s". */
const seconds = (n: number): string => (n < 60 ? `${n}s` : n % 60 === 0 ? `${Math.floor(n / 60)}m` : `${Math.floor(n / 60)}m ${n % 60}s`);

/**
 * What the hub measured about a session: model, tokens, cost, duration. A value it does not know (null) or a zero is left
 * out, never shown as "0s" or "$0.00" (`admin-principles.md` rule 5). Empty when nothing is known.
 */
export function sessionFacts(s: ActivitySessionDto): string[] {
  const out: string[] = [];
  if (s.model) out.push(s.model);
  if (s.tokens && s.tokens.in + s.tokens.out > 0) out.push(`${tokens(s.tokens.in)} in, ${tokens(s.tokens.out)} out`);
  // Below half a cent `usd` would print "$0.00".
  if (s.costUsd !== null && s.costUsd >= 0.005) out.push(usd(s.costUsd));
  if (s.durationS !== null && s.durationS > 0) out.push(seconds(s.durationS));
  return out;
}

// The agent's reason codes in the owner's words (UX pass 2026-11-20). The agent writes a skip as `<code>: <its own words>`
// (skills README, Report: `skipped:<code>`); the code stays in the data and the screen says a short phrase for it, with the
// agent's words kept as the muted detail. Tested in `test/log-reasons.test.ts`.

/** One phrase per code the skills name (README Report codes, sequence-drafts' `open-draft` and its stop reasons). Keys use dashes. */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  "already-drafted": "Already has a draft",
  "not-allowed-recipient": "Not an allowed recipient",
  "do-not-contact": "Do not contact",
  "last-is-ours": "We wrote last",
  "no-message-to-reply": "No message to reply to",
  scheduling: "Wants a meeting",
  cap: "Over the run's limit",
  "open-draft": "Has an open draft",
  error: "Error",
  replied: "They replied",
  bounced: "Mail bounced",
  "opted-out": "Opted out",
  "out-of-office": "Out of office",
  closed: "Deal closed",
  excluded: "Excluded",
  stopped: "Stopped",
};

/** What a reason reads as: the phrase and the agent's own words after the code (null when it wrote none). */
export type Reason = { code: string | null; phrase: string; detail: string | null };

/** A code is lowercase words joined by `-` or `_`; `draft.recipients=test: ...` is not one (it is the agent's words). */
const CODED = /^(?:skipped\s*:\s*)?([a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)(?:(\s*:\s*|\s*,\s*)([\s\S]*))?$/;

const keyOf = (code: string): string => code.replaceAll("_", "-");

/** "out_of_office" or "some-new-code" as words: "Out of office", "Some new code". */
export const humanise = (code: string): string => {
  const s = code.replace(/[-_]+/g, " ").trim();
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
};

const blank = (s: string | undefined): string | null => (s && s.trim() !== "" ? s.trim() : null);

/**
 * Reads a reason. A known code, with or without words after it; an unknown one only when a colon follows it or it has a
 * dash or underscore, so a one-word reason ("newsletter") stays the agent's word. `error:<tool>` names the tool. Anything
 * else is the agent's own sentence, shown as written (code null).
 */
export function readReason(why: string): Reason {
  const text = why.trim();
  const m = CODED.exec(text);
  if (m) {
    const [, code = "", sep = "", rest] = m;
    const known = REASON_LABELS[keyOf(code)];
    const colon = sep.includes(":");
    if (known !== undefined || (sep !== "" && colon) || /[-_]/.test(code)) {
      // A comma after an unknown word is a sentence ("newsletter, no reply"), not a code.
      if (known === undefined && sep !== "" && !colon) return { code: null, phrase: text, detail: null };
      if (keyOf(code) === "error" && colon) {
        const tool = /^([a-z][a-z0-9_-]*)(?:\s*:\s*([\s\S]*))?$/i.exec(rest ?? "");
        if (tool?.[1]) return { code, phrase: `Error in ${tool[1]}`, detail: blank(tool[2]) };
      }
      return { code, phrase: known ?? humanise(code), detail: blank(rest) };
    }
  }
  return { code: null, phrase: text, detail: null };
}

// How a session's rows are shown (UX pass 2026-11-20): the same client with the same outcome in a row is one line with a
// count, and a time on another day than the session's heading carries its date. Tested in `test/log-groups.test.ts`.


/** Local calendar day, the one the heading's date is written in. */
const sameDay = (a: string, b: string): boolean => {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

/** "21:48" under a heading of the same day, "19 Nov, 11:05" under one of another (an entry after midnight). */
export const entryTime = (at: string, headingAt: string): string => (sameDay(at, headingAt) ? hhmm(at) : formatTime(at));

/** The entries one line of the table stands for: one row, or a run of the same client with the same outcome. */
export type RowGroup = { rows: readonly [ActivityRowDto, ...ActivityRowDto[]] };

/** Notes never fold: each is the agent's own words. A decision folds with the next one of the same client and outcome. */
const groupKey = (r: ActivityRowDto): string | null => (isDecision(r) ? `${r.client ? `c${r.client.id}` : `w:${r.who}`}|${r.outcome}` : null);

/** Consecutive decisions of one client with one outcome become one group; order is kept. */
export function groupRows(rows: readonly ActivityRowDto[]): RowGroup[] {
  const out: Array<{ rows: [ActivityRowDto, ...ActivityRowDto[]] }> = [];
  let lastKey: string | null = null;
  for (const r of rows) {
    const key = groupKey(r);
    const last = out.at(-1);
    if (last && key !== null && key === lastKey) last.rows.push(r);
    else out.push({ rows: [r] });
    lastKey = key;
  }
  return out;
}

/** The parts of a row's reason: a short phrase for a code, the agent's words as the detail; a note keeps its own words. */
export function reasonParts(r: ActivityRowDto): { why: string; detail: string | null } {
  if (!isDecision(r)) return { why: r.why ?? r.who, detail: null };
  if (r.why === null || r.why.trim() === "") return { why: "", detail: null };
  const { phrase, detail } = readReason(r.why);
  return { why: phrase, detail };
}

/** What a line of the table shows. `count` is 1 for a single entry; `why` and `detail` only when every entry says the same. */
export type GroupCells = { who: string; what: string; count: number; when: string; why: string; detail: string | null; draftId: number | null };

const one = <T,>(values: readonly T[]): T | null => (values.every((v) => v === values[0]) ? (values[0] ?? null) : null);

/**
 * "Mark Effect · Drafted · ×6 · 21:48 – 19 Nov, 11:05". The name links into a draft only when every entry points at the
 * same one; otherwise each entry links its own when expanded.
 */
export function groupCells(g: RowGroup, headingAt: string): GroupCells {
  const first = g.rows[0];
  const last = g.rows[g.rows.length - 1] ?? first;
  const who = isDecision(first) ? (first.client?.name ?? first.who) : (first.client?.name ?? "");
  const parts = g.rows.map(reasonParts);
  const when = g.rows.length === 1 ? entryTime(first.at, headingAt) : `${entryTime(first.at, headingAt)} – ${entryTime(last.at, headingAt)}`;
  return {
    who,
    what: ACTIVITY_OUTCOME_LABELS[first.outcome],
    count: g.rows.length,
    when,
    why: one(parts.map((p) => p.why)) ?? "",
    detail: one(parts.map((p) => p.detail)),
    draftId: one(g.rows.map((r) => r.draftId)),
  };
}
