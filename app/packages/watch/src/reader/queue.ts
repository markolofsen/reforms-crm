import { FloodWaitError, type OwnerActivity } from "./types";

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

export class WatchParked extends Error {
  constructor(readonly until: string, readonly why: string) {
    super(`the watcher is parked until ${until}: ${why}`);
    this.name = "WatchParked";
  }
}

export class WatchBudgetSpent extends Error {
  constructor(readonly kind: CallKind) {
    super(kind === "resolve" ? `the watcher used its ${RESOLVES_PER_DAY} username resolves for today` : `the watcher used its ${JOINS_PER_RUN} joins for this run`);
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
  /** A new run (a restart): the join count starts again. */
  resetRun(): void;
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function createWatchQueue(o: { owner: OwnerActivity; clock?: Partial<QueueClock>; onPark?: (until: string, note: FloodNote) => void }): WatchQueue {
  const clock: QueueClock = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: Math.random, ...o.clock };
  let tail: Promise<unknown> = Promise.resolve();
  let lastHistory = -Infinity;
  let lastJoin = -Infinity;
  let joins = 0;
  let resolves = { day: "", n: 0 };
  let parked: number | null = null;
  let flood: FloodNote | null = null;

  const gate = async (kind: CallKind) => {
    if (parked !== null && clock.now() < parked) throw new WatchParked(new Date(parked).toISOString(), "Telegram asked the account to wait (FLOOD_WAIT)");
    parked = null;
    if (kind === "resolve") {
      const today = utcDay(clock.now());
      if (resolves.day !== today) resolves = { day: today, n: 0 };
      if (resolves.n >= RESOLVES_PER_DAY) throw new WatchBudgetSpent("resolve");
    }
    if (kind === "join" && joins >= JOINS_PER_RUN) throw new WatchBudgetSpent("join");
    const gap = kind === "history" ? HISTORY_GAP_MS - (clock.now() - lastHistory) : kind === "join" ? JOIN_GAP_MS[0] + clock.random() * (JOIN_GAP_MS[1] - JOIN_GAP_MS[0]) - (clock.now() - lastJoin) : 0;
    if (gap > 0) await clock.sleep(gap);
    while (o.owner.busy()) await clock.sleep(OWNER_POLL_MS);
  };

  const run = <T>(kind: CallKind, call: () => Promise<T>): Promise<T> => {
    const job = tail.then(async () => {
      await gate(kind);
      if (kind === "resolve") resolves.n += 1;
      if (kind === "join") joins += 1;
      try {
        return await call();
      } catch (e) {
        if (e instanceof FloodWaitError) {
          parked = clock.now() + e.seconds * 1000 + FLOOD_EXTRA_MS;
          flood = { at: new Date(clock.now()).toISOString(), seconds: e.seconds, by: "watcher", kind };
          o.onPark?.(new Date(parked).toISOString(), flood);
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
    parkedUntil: () => (parked !== null && clock.now() < parked ? new Date(parked).toISOString() : null),
    lastFlood: () => flood,
    resolvesLeft: () => (resolves.day === utcDay(clock.now()) ? Math.max(0, RESOLVES_PER_DAY - resolves.n) : RESOLVES_PER_DAY),
    resetRun: () => {
      joins = 0;
    },
  };
}
