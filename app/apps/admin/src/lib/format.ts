const DAY_MS = 86_400_000;

/** Whole days since `iso`, for "silent for 12d". `now` is injected (see `lib/clock.ts`). */
export function silence(iso: string | null, now: number): string {
  if (!iso) return "-";
  const days = Math.floor((now - new Date(iso).getTime()) / DAY_MS);
  return days <= 0 ? "today" : `${days}d`;
}

/** A ready draft nobody touched for this long is probably forgotten in Mail. */
export const OLD_DAYS = 30;
export const isOld = (updatedAt: string, now: number) => now - new Date(updatedAt).getTime() > OLD_DAYS * DAY_MS;

export const formatTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export const formatClock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function duration(start: string, end: string | null): string {
  if (!end) return "running";
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const usd = (n: number) => (n > 0 ? `$${n.toFixed(2)}` : "-");
export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** "They wrote 6 days ago" for the card header; null when nobody wrote yet. */
export function wrote(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const days = Math.floor((now - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return "They wrote today";
  return `They wrote ${plural(days, "day")} ago`;
}

/** "1 event", "3 events": the noun agrees with the count. */
export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "just now", "12 min ago", "3 h ago", "2 d ago". `now` comes from the clock, never from `Date.now()`. */
export function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} d ago`;
}
