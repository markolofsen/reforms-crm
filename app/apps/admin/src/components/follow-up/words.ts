import { FOLLOW_UP_CHANNEL_LABELS, FOLLOW_UP_DISPLAY_LABELS, FOLLOW_UP_NUDGES_IN_A_ROW, FOLLOW_UP_STOP_LABELS } from "@hub/config/follow-ups";
import type { FollowUpDto, FollowUpsDto, FollowUpTodayDto } from "@hub/contract/follow-ups";

// The words of the daily follow-up sweep in the admin (P142 F6, verdict 15), as pure functions of the contract: Overview's line,
// Activity ▸ Follow-ups, the conversation header and the list chips say a plan the same way (Vitest: `test/follow-up-words.test.ts`).

/** "30 Nov" (a plan's date is a calendar day, read as UTC so the day never shifts). */
export const shortDay = (iso: string): string => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "25 Nov" of a moment (a sweep's start, a nudge's send), in the reader's zone. */
export const dayOfMoment = (iso: string): string => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** "Follow-ups today: 3 ready · 5 waiting · 1 stopped · 1 for you"; a due count only when there is one. */
export function todayLine(t: FollowUpTodayDto): string {
  const parts = [`${t.ready} ready`, ...(t.due > 0 ? [`${t.due} due`] : []), `${t.waiting} waiting`, `${t.stopped} stopped`, `${t.forYou} for you`];
  return `Follow-ups today: ${parts.join(" · ")}`;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const sameDay = (a: string, b: Date) => new Date(a).toDateString() === b.toDateString();

/** "swept 09:02 · next tomorrow 09:00", "sweeping now", "not swept yet · next today 09:00", "the schedule is off". */
export function sweepLine(s: FollowUpsDto["sweep"], now: Date): string {
  const last = s.running ? "sweeping now" : s.last ? `swept ${sameDay(s.last.startedAt, now) ? time(s.last.startedAt) : `${dayOfMoment(s.last.startedAt)} ${time(s.last.startedAt)}`}` : "not swept yet";
  if (s.schedule === "off" || !s.next) return `${last} · the daily sweep is off`;
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const day = sameDay(s.next, now) ? "today" : sameDay(s.next, tomorrow) ? "tomorrow" : dayOfMoment(s.next);
  return `${last} · next ${day} ${time(s.next)}`;
}

/** Why Run follow-ups now is off (the server's reason), or null: a click while a sweep runs joins it. */
export const runNowOff = (s: FollowUpsDto["sweep"]): string | null => s.runNowOff;

/** The stop of the last sweep, Overview's item: "Follow-ups stopped: three turns failed in a row". */
export const stoppedLine = (s: FollowUpsDto["sweep"]): string | null => (s.stopped ? `Follow-ups stopped: ${s.stopped}` : null);

/** The state word of a plan (Activity's column): "Nudge ready", "Due", "Waiting", "Stopped · no answer", "For you", "Answered". */
export const stateWord = (r: FollowUpDto): string => (r.display === "stopped" && r.stopReason ? `${FOLLOW_UP_DISPLAY_LABELS.stopped} · ${FOLLOW_UP_STOP_LABELS[r.stopReason]}` : FOLLOW_UP_DISPLAY_LABELS[r.display]);

/** The channel mark: "Mail", "WhatsApp", or a dash before any nudge. */
export const channelWord = (r: FollowUpDto): string => (r.channel ? FOLLOW_UP_CHANNEL_LABELS[r.channel] : "-");

/** "2 of ~3 sent": the cadence is about three nudges, the agent's judgement, never a hard cap. */
export const sentWord = (r: FollowUpDto): string => `${r.nudgesSent} of ~${FOLLOW_UP_NUDGES_IN_A_ROW} sent`;

/** The next date of a waiting plan, or a dash. */
export const nextWord = (r: FollowUpDto): string => (r.nextAt && (r.state === "waiting" || r.state === "handed_over") ? shortDay(r.nextAt) : "-");

/** "Follow-up · next 30 Nov · 2nd sent 25 Nov · waiting on them": the conversation header's facts line (Mail and Messengers). */
export function headerLine(r: FollowUpDto): string {
  const parts = ["Follow-up"];
  if (r.state === "stopped") parts.push(r.stopReason ? `stopped: ${FOLLOW_UP_STOP_LABELS[r.stopReason]}` : "stopped");
  else if (r.state === "handed_over") parts.push("for you");
  else if (r.state === "answered") parts.push("answered");
  else if (r.display === "ready") parts.push("nudge ready");
  else if (r.nextAt) parts.push(`next ${shortDay(r.nextAt)}`);
  else parts.push("due");
  if (r.nudgesSent > 0 && r.lastNudgeAt) parts.push(`${ordinal(r.nudgesSent)} sent ${dayOfMoment(r.lastNudgeAt)}`);
  if (r.waitingOn && r.state !== "stopped" && r.state !== "answered") parts.push(`waiting on ${r.waitingOn}`);
  return parts.join(" · ");
}

/** The list chip: "Follow-up 30 Nov", "Follow-up ready", "Follow-up due", "Follow-up for you"; none for a stopped or answered plan. */
export function chipWord(r: FollowUpDto): string | null {
  if (r.display === "ready") return "Follow-up ready";
  if (r.display === "due") return "Follow-up due";
  if (r.display === "handed_over") return "Follow-up for you";
  if (r.display === "waiting" && r.nextAt) return `Follow-up ${shortDay(r.nextAt)}`;
  return null;
}

/** The owner's moves on a plan: Change date always (it waits again until then), Stop unless stopped, Resume only a stopped one. */
export const moves = (r: FollowUpDto): { date: true; stop: boolean; resume: boolean } => ({ date: true, stop: r.state !== "stopped", resume: r.state === "stopped" });

/** The plan of one client, or null (the header and the chips read the project's one list). */
export const planOf = (rows: readonly FollowUpDto[] | undefined, clientId: number | null | undefined): FollowUpDto | null => (clientId == null ? null : (rows?.find((r) => r.clientId === clientId) ?? null));

/** The chip word of one client's plan, or null (no plan, or one that shows no chip). */
export function chipFor(rows: readonly FollowUpDto[] | undefined, clientId: number | null | undefined): string | null {
  const p = planOf(rows, clientId);
  return p ? chipWord(p) : null;
}

/** A date field's value: today or later, YYYY-MM-DD. */
export const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (v: string, today: string): boolean => DATE_VALUE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && v >= today;
