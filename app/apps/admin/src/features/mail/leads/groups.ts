import type { LeadFactsDto, LeadRowDto } from "@hub/contract/inbound";
import { dayLabel, localDay } from "@/features/log/groups";

// P138 verdict 6: the Leads list under a heading per local day ("Today", "Yesterday", "18 Nov"), the rows kept newest first, and
// which rows arrived after the owner's last visit. Pure; tested in `test/lead-groups.test.ts`.

export type LeadDay = { day: string; label: string; rows: LeadRowDto[] };

/** Consecutive rows of one local day under one heading (the rows come newest first). `now` comes from the clock. */
export function leadDays(rows: readonly LeadRowDto[], now: number): LeadDay[] {
  const out: LeadDay[] = [];
  for (const r of rows) {
    const day = localDay(r.receivedAt);
    const last = out.at(-1);
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, label: dayLabel(day, now), rows: [r] });
  }
  return out;
}

/** A row is new since the last visit when it arrived after the newest lead that visit saw; the first visit marks none. */
export const isNewSince = (r: Pick<LeadRowDto, "receivedAt">, seen: string | null): boolean => seen !== null && r.receivedAt > seen;

/** The row's chips, in order: the country, the segment, the volume. */
export const factChips = (f: LeadFactsDto): string[] => [f.country, f.segment, f.volume].filter((v): v is string => !!v);

/** The newest arrival of a list (what this visit has seen), else null. */
export const newestOf = (rows: readonly Pick<LeadRowDto, "receivedAt">[]): string | null => rows.reduce<string | null>((m, r) => (m === null || r.receivedAt > m ? r.receivedAt : m), null);

/** One project's visits: the newest lead the previous visit saw (`prev`, the dot's line) and the newest this visit saw (`last`). */
export type SeenVisit = { prev: string | null; last: string };

/** The stored map, `{ <project>: { prev, last } }`; anything else is empty. */
export function parseSeen(raw: string | null): Record<string, SeenVisit> {
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, SeenVisit> = {};
    for (const [k, x] of Object.entries(v)) {
      if (!x || typeof x !== "object") continue;
      const f: Record<string, unknown> = Object.fromEntries(Object.entries(x));
      const { prev, last } = f;
      if (typeof last === "string") out[k] = { prev: typeof prev === "string" ? prev : null, last };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The next stored visit: a new visit (`fresh`) moves `last` into `prev`; within a visit only `last` grows. Pure.
 */
export function nextVisit(old: SeenVisit | undefined, newest: string, fresh: boolean): SeenVisit {
  if (!old) return { prev: null, last: newest };
  if (fresh) return { prev: old.last, last: newest > old.last ? newest : old.last };
  return { prev: old.prev, last: newest > old.last ? newest : old.last };
}
