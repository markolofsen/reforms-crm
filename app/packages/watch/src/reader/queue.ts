import { FloodWaitError, type OwnerActivity } from "./types";
import type { AccountJournal } from "./account-state";

/**
 * The watcher's own rate budget on the account (P144 verdict 11), one queue per account, far under Telegram's limits:
 *
 * - at most one history pull every 3 s, and at most 20 username resolves a UTC day;
 * - joins only one at a time, at most 3 per run, 3 to 4.5 minutes apart;
 * - the owner's own work goes first: while it is busy, the next watcher call waits;
 * - a FLOOD_WAIT on any watcher call parks the whole queue for the wait plus an hour. The owner's calls never pass through this
 *   queue, so a park stops only the watcher; but Telegram rates the account, so the wait can also slow the owner's chat reads.
 *   That is said on the Overview (`lastFlood`), never promised away.
 */

export const HISTORY_GAP_MS = 3000;
export const RESOLVES_PER_DAY = 20;
export const JOINS_PER_RUN = 3;
export const JOIN_GAP_MS = [180_000, 270_000] as const;
export const FLOOD_EXTRA_MS = 3_600_000;
/** How often a call waiting on the owner looks again. */
export const OWNER_POLL_MS = 500;

export type CallKind = "history" | "resolve" | "join";
export interface JoinStatus { used: number; limit: number; day: string; nextAt: string | null; reason: string | null }

export class WatchParked extends Error {
  constructor(readonly until: string, readonly why: string) {
    super(`the watcher is parked until ${until}: ${why}`);
    this.name = "WatchParked";
  }
}

export class WatchBudgetSpent extends Error {
  constructor(readonly kind: CallKind, joins = JOINS_PER_RUN, daily = false) {
    super(kind === "resolve" ? `the watcher used its ${RESOLVES_PER_DAY} username resolves for today` : `the watcher used its ${joins} joins for ${daily ? "today" : "this run"}`);
    this.name = "WatchBudgetSpent";
  }
}

export interface QueueClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export interface FloodNote {
  at: string;
  seconds: number;
  /** Whose call earned it: always the watcher here (the owner's calls are counted by the supervisor). */
  by: "watcher";
  kind: CallKind;
}

export interface WatchQueue {
  /** Runs one call in turn, under the budget; a FLOOD_WAIT parks the queue and rethrows. */
  run<T>(kind: CallKind, call: () => Promise<T>): Promise<T>;
  parkedUntil(): string | null;
  lastFlood(): FloodNote | null;
  resolvesLeft(): number;
  joinStatus(): JoinStatus;
  park(seconds: number, kind?: CallKind): void;
  parkReason(): string | null;
  /** A new run (a restart): the join count starts again. */
  resetRun(): void;
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function createWatchQueue(o: {
  owner: OwnerActivity;
  clock?: Partial<QueueClock>;
  onPark?: (until: string, note: FloodNote) => void;
  /** P153 D4: the resolves already made on a UTC day by the watch files that share this account, so a restart keeps the count. */
  resolvedOn?: (day: string) => number;
  /** Canonical account state shared by every project and retained across restarts. */
  account?: { id: string; journal: AccountJournal; joinsPerDay: () => number };
}): WatchQueue {
  const clock: QueueClock = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: Math.random, ...o.clock };
  let tail: Promise<unknown> = Promise.resolve();
  let lastHistory = -Infinity;
  let lastJoin = -Infinity;
  let joins = 0;
  let resolves = { day: "", n: 0 };
  let parked: number | null = null;
  let flood: FloodNote | null = null;

  const stored = () => o.account?.journal.read(o.account.id, clock.now());
  const parkTime = (): number | null => {
    const saved = stored();
    if (saved && !saved.ok) return Date.parse("2099-12-31T00:00:00Z");
    const until = Math.max(parked ?? 0, saved?.ok ? saved.usage.floodUntil : 0);
    return until > clock.now() ? until : null;
  };
  const parkReason = (): string | null => {
    const saved = stored();
    return saved && !saved.ok ? saved.reason : parkTime() === null ? null : "Telegram asked the account to wait (FLOOD_WAIT); Watch waits an hour more.";
  };
  const joinStatus = (): JoinStatus => {
    const saved = stored();
    const limit = o.account?.joinsPerDay() ?? JOINS_PER_RUN;
    if (saved && !saved.ok) return { used: 0, limit, day: utcDay(clock.now()), nextAt: null, reason: saved.reason };
    const used = saved?.ok ? saved.usage.joins : joins;
    const day = saved?.ok ? saved.usage.day : utcDay(clock.now());
    const next = Math.max(saved?.ok ? saved.usage.nextJoinAt : lastJoin + JOIN_GAP_MS[0], parkTime() ?? 0,
      used >= limit && o.account && limit > 0 ? Date.parse(`${day}T00:00:00Z`) + 86_400_000 : 0);
    return { used, limit, day, nextAt: Number.isFinite(next) && next > clock.now() ? new Date(next).toISOString() : null,
      reason: limit === 0 ? "Joining is disabled by the account policy." : used >= limit ? "The account's join budget is spent." : parkReason() };
  };
  const park = (seconds: number, kind: CallKind = "history") => {
    parked = Math.max(parked ?? 0, clock.now() + seconds * 1000 + FLOOD_EXTRA_MS);
    o.account?.journal.park(o.account.id, parked, clock.now());
    flood = { at: new Date(clock.now()).toISOString(), seconds, by: "watcher", kind };
    o.onPark?.(new Date(parked).toISOString(), flood);
  };

  const gate = async (kind: CallKind) => {
    const until = parkTime();
    if (until !== null) throw new WatchParked(new Date(until).toISOString(), parkReason() ?? "The account is parked");
    parked = null;
    if (kind === "resolve") {
      const today = utcDay(clock.now());
      if (resolves.day !== today) resolves = { day: today, n: o.resolvedOn?.(today) ?? 0 };
      if (resolves.n >= RESOLVES_PER_DAY) throw new WatchBudgetSpent("resolve");
    }
    if (kind === "join" && joinStatus().used >= joinStatus().limit) throw new WatchBudgetSpent("join", joinStatus().limit, !!o.account);
    const gap = kind === "history" ? HISTORY_GAP_MS - (clock.now() - lastHistory) : kind === "join" ? o.account
      ? Math.max(0, Date.parse(joinStatus().nextAt ?? "") - clock.now()) || 0
      : JOIN_GAP_MS[0] + clock.random() * (JOIN_GAP_MS[1] - JOIN_GAP_MS[0]) - (clock.now() - lastJoin) : 0;
    if (gap > 0) await clock.sleep(gap);
    while (o.owner.busy()) await clock.sleep(OWNER_POLL_MS);
    const parkedAgain = parkTime();
    if (parkedAgain !== null) throw new WatchParked(new Date(parkedAgain).toISOString(), parkReason() ?? "The account is parked");
  };

  const run = <T>(kind: CallKind, call: () => Promise<T>): Promise<T> => {
    const job = tail.then(async () => {
      await gate(kind);
      if (kind === "resolve") resolves.n += 1;
      if (kind === "join") {
        o.account?.journal.reserve(o.account.id, o.account.joinsPerDay(), clock.now(), JOIN_GAP_MS[0] + clock.random() * (JOIN_GAP_MS[1] - JOIN_GAP_MS[0]));
        joins += 1;
      }
      const beforeCall = parkTime();
      if (beforeCall !== null) throw new WatchParked(new Date(beforeCall).toISOString(), parkReason() ?? "The account is parked");
      try {
        return await call();
      } catch (e) {
        if (e instanceof FloodWaitError) {
          park(e.seconds, kind);
        }
        throw e;
      } finally {
        if (kind === "history") lastHistory = clock.now();
        if (kind === "join") lastJoin = clock.now();
      }
    });
    tail = job.catch(() => undefined);
    return job;
  };

  return {
    run,
    parkedUntil: () => { const until = parkTime(); return until === null ? null : new Date(until).toISOString(); },
    parkReason,
    joinStatus,
    park,
    lastFlood: () => flood,
    resolvesLeft: () => {
      const today = utcDay(clock.now());
      return Math.max(0, RESOLVES_PER_DAY - (resolves.day === today ? resolves.n : (o.resolvedOn?.(today) ?? 0)));
    },
    resetRun: () => {
      if (!o.account) joins = 0;
    },
  };
}
