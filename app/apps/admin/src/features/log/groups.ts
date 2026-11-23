import { ACTIVITY_OUTCOME_LABELS, type ActivityRowDto } from "@hub/contract/activity";
import { refOf } from "@hub/contract/focus";
import { hhmm } from "@/lib/format";
import { reasonParts } from "./labels";

// How the timeline is shown (P73, decision 0037): a heading per local day ("Today", "Yesterday", "18 Nov"), and inside a
// day the same client with the same outcome in a row folds to one line with its count and time range. A fold never
// crosses a day: a save on 18 Nov and one on 19 Nov are two lines. Pure; tested in `test/log-groups.test.ts`.

/** The entries one line of the table stands for: one row, or a run of the same client with the same outcome on one day. */
export type RowGroup = { rows: readonly [ActivityRowDto, ...ActivityRowDto[]] };
/** One local day of the timeline: its heading's words and its lines, newest first. */
export type DaySection = { day: string; label: string; groups: RowGroup[] };

const pad = (n: number): string => String(n).padStart(2, "0");
/** The local calendar day of a time, `2026-11-19`: the day a heading is written in. */
export const localDay = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** "Today", "Yesterday", "18 Nov", or "18 Nov 2025" in another year. `now` comes from the clock (`lib/clock.ts`). */
export function dayLabel(day: string, now: number): string {
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day === localDay(today.toISOString())) return "Today";
  if (day === localDay(yesterday.toISOString())) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
}

const groupKey = (r: ActivityRowDto): string => `${localDay(r.at)}|${r.client ? `c${r.client.id}` : `w:${r.who}`}|${r.outcome}`;

/** Consecutive rows of one client with one outcome on one local day become one group; order is kept. */
export function groupRows(rows: readonly ActivityRowDto[]): RowGroup[] {
  const out: Array<{ rows: [ActivityRowDto, ...ActivityRowDto[]] }> = [];
  let lastKey: string | null = null;
  for (const r of rows) {
    const key = groupKey(r);
    const last = out.at(-1);
    if (last && key === lastKey) last.rows.push(r);
    else out.push({ rows: [r] });
    lastKey = key;
  }
  return out;
}

/** The timeline (newest first) under a heading per local day, each day's lines folded. */
export function daySections(rows: readonly ActivityRowDto[], now: number): DaySection[] {
  const out: DaySection[] = [];
  for (const g of groupRows(rows)) {
    const day = localDay(g.rows[0].at);
    const last = out.at(-1);
    if (last && last.day === day) last.groups.push(g);
    else out.push({ day, label: dayLabel(day, now), groups: [g] });
  }
  return out;
}

/** What a line of the table shows. `count` is 1 for a single entry; `why`, `detail`, `draftId`, `chatId` and `skill` only when every entry shares them. */
export type GroupCells = { who: string; what: string; count: number; when: string; why: string; detail: string | null; draftId: number | null; chatId: number | null; skill: string | null };

const one = <T,>(values: readonly T[]): T | null => (values.every((v) => v === values[0]) ? (values[0] ?? null) : null);

/** "Mark Effect · Updated the draft ×9 · 11:05 – 20:50": the range runs from the oldest entry to the newest (the rows are newest first). */
export function groupCells(g: RowGroup): GroupCells {
  const first = g.rows[0];
  const times = g.rows.map((r) => r.at).sort();
  const parts = g.rows.map(reasonParts);
  const oldest = times[0] ?? first.at;
  const newest = times.at(-1) ?? first.at;
  return {
    who: first.client?.name ?? first.who,
    what: ACTIVITY_OUTCOME_LABELS[first.outcome],
    count: g.rows.length,
    when: g.rows.length === 1 || hhmm(oldest) === hhmm(newest) ? hhmm(newest) : `${hhmm(oldest)} – ${hhmm(newest)}`,
    why: one(parts.map((p) => p.why)) ?? "",
    detail: one(parts.map((p) => p.detail)),
    draftId: one(g.rows.map((r) => r.draftId)),
    chatId: one(g.rows.map((r) => r.chatId)),
    skill: one(g.rows.map((r) => r.skill)),
  };
}

/** The ref a line publishes (P72): the draft it names, else its client, else none (a sender with no client row). */
export const lineRef = (c: Pick<GroupCells, "draftId">, r: ActivityRowDto): string | null => (c.draftId !== null ? refOf("draft", c.draftId) : r.client ? refOf("client", r.client.id) : null);
