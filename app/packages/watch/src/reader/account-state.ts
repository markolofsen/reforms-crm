import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";

const Entry = z.strictObject({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), joins: z.number().int().nonnegative(), nextJoinAt: z.number().nonnegative(), floodUntil: z.number().nonnegative(), lastClock: z.number().nonnegative() });
const Journal = z.strictObject({ version: z.literal(1), accounts: z.record(z.string().regex(/^[0-9]{3,20}$/), Entry).refine((x) => Object.keys(x).length <= 100) });
type Data = z.infer<typeof Journal>;
export type AccountUsage = z.infer<typeof Entry>;
export type AccountRead = { ok: true; usage: AccountUsage } | { ok: false; reason: string };
export interface AccountJournal {
  read(account: string, now: number): AccountRead;
  reserve(account: string, limit: number, now: number, gapMs: number): void;
  park(account: string, until: number, now: number): void;
}

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
const fresh = (now: number): AccountUsage => ({ day: utcDay(now), joins: 0, nextJoinAt: 0, floodUntil: 0, lastClock: now });
const current = (entry: AccountUsage | undefined, now: number): AccountUsage => {
  const value = entry ?? fresh(now);
  const clock = Math.max(now, value.lastClock);
  const day = utcDay(clock);
  return { ...value, ...(day > value.day ? { day, joins: 0 } : {}), lastClock: clock };
};

/** One server-owned journal for all project/account aliases. An invalid or busy journal never becomes an empty budget. */
export function accountJournal(file: string): AccountJournal {
  const lock = `${file}.lock`;
  const read = (): Data => {
    if (!existsSync(file)) return { version: 1, accounts: {} };
    const raw = readFileSync(file, "utf8");
    if (raw.length > 65_536) throw new Error("Watch account journal is too large");
    return Journal.parse(JSON.parse(raw));
  };
  const acquire = (): number => {
    mkdirSync(dirname(file), { recursive: true });
    // A stale lock is repaired only with the server stopped. Never race another writer by unlinking a dead pid's path.
    return openSync(lock, "wx", 0o600);
  };
  const change = (account: string, now: number, fn: (usage: AccountUsage) => AccountUsage) => {
    if (!/^[0-9]{3,20}$/.test(account)) throw new Error("A resolved account is required");
    const fd = acquire();
    const token = randomUUID();
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      const data = read();
      data.accounts[account] = fn(current(data.accounts[account], now));
      Journal.parse(data);
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
      renameSync(temp, file);
    } finally {
      closeSync(fd);
      const owner = z.strictObject({ pid: z.number().int().positive(), token: z.string() }).parse(JSON.parse(readFileSync(lock, "utf8")));
      if (owner.token !== token) throw new Error("Watch account journal lock ownership changed");
      unlinkSync(lock);
    }
  };
  return {
    read(account, now) {
      try {
        if (existsSync(lock)) throw new Error("Watch account journal is locked");
        return { ok: true, usage: current(read().accounts[account], now) };
      } catch { return { ok: false, reason: "Watch account journal is locked or unreadable; actions stay paused until it is repaired." }; }
    },
    reserve(account, limit, now, gapMs) {
      change(account, now, (u) => {
        if (u.floodUntil > now || u.nextJoinAt > now) throw new Error("The account's next join is not due");
        if (u.joins >= limit) throw new Error("The account's daily join budget is spent");
        return { ...u, joins: u.joins + 1, nextJoinAt: Math.max(now, u.lastClock) + gapMs };
      });
    },
    park(account, until, now) { change(account, now, (u) => ({ ...u, floodUntil: Math.max(u.floodUntil, Math.max(now, u.lastClock) + Math.max(0, until - now)) })); },
  };
}
