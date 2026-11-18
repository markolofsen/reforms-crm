import type { EnrollmentState, SequenceDisplayState } from "@hub/config";

// Due maths. Business days are Monday to Friday on the machine's local date; there is no holiday calendar and the client's
// time zone is not used (P47 W1). A due moment is the start of a local day: a step is due all of that day.

const DAY = 86_400_000;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * The local day `n` days after `fromIso`, as an ISO instant at its start. With `businessDays` only Monday to Friday are
 * counted, so Friday + 2 is Tuesday and Saturday + 1 is Monday. `n` 0 is the start of the same day.
 */
export function addDays(fromIso: string, n: number, businessDays: boolean): string {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) throw new Error(`not a date: ${fromIso}`);
  const d = startOfLocalDay(from);
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    // Step by the calendar, not by 24 h, so a daylight-saving change never lands on the wrong day.
    d.setDate(d.getDate() + 1);
    if (!businessDays || !isWeekend(d)) left--;
  }
  return d.toISOString();
}

/** The later of two instants (null counts as the earliest). */
export const later = (a: string | null, b: string): string => (a !== null && Date.parse(a) > Date.parse(b) ? a : b);

/** Whole days from `fromIso` to `now`, rounded down; negative when `fromIso` is in the future. */
export const daysSince = (fromIso: string, now: Date): number => Math.floor((now.getTime() - Date.parse(fromIso)) / DAY);

export type DueInput = { state: EnrollmentState; nextDueAt: string | null };

/** Due: active, the date has come, and no draft of the client is open (one open draft per client already holds the step). */
export const isDue = (e: DueInput, now: Date, hasOpenDraft: boolean): boolean => e.state === "active" && !hasOpenDraft && e.nextDueAt !== null && Date.parse(e.nextDueAt) <= now.getTime();

/** What a row shows. Derived on every read; only `active`, `paused` and `finished` are stored. */
export function displayStateOf(e: DueInput, now: Date, hasOpenDraft: boolean): SequenceDisplayState {
  if (e.state === "finished") return "finished";
  if (e.state === "paused") return "paused";
  if (hasOpenDraft) return "draft_ready";
  return isDue(e, now, false) ? "due" : "waiting";
}
