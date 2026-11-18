import type { RunStatus } from "@hub/config";
import { ACTIVITY_OUTCOME_LABELS, type ActivityRowDto, type ActivitySessionDto } from "@hub/contract/activity";
import { formatTime, plural, tokens, usd } from "@/lib/format";
import type { RunFilter } from "@/routes/search";

// The words of the Activity screen, as pure functions of the contract (a Vitest test sits beside this file).

export const RUN_FILTER_LABELS: Record<RunFilter, string> = { all: "All", needs_human: "Needs you", failed: "Failed", ok: "Done" };
export const RUN_FILTER_ORDER: readonly RunFilter[] = ["all", "needs_human", "failed", "ok"];

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

/** The three cells a row shows. A note has no client of its own: its text is the agent's words. */
export function rowCells(r: ActivityRowDto): { who: string; what: string; why: string } {
  if (!isDecision(r)) return { who: r.client?.name ?? "", what: ACTIVITY_OUTCOME_LABELS[r.outcome], why: r.why ?? r.who };
  return { who: r.client?.name ?? r.who, what: ACTIVITY_OUTCOME_LABELS[r.outcome], why: r.why ?? "" };
}

const asSentence = (t: string): string => {
  const s = t.trim();
  return s === "" ? "" : `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}`;
};

/** "Marta Gomes: escalated. Asks about a discount." or "Note: Updated 3 client profiles in Notion." */
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
