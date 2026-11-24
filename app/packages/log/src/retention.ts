import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ops } from "./ops/logger";

// P137 verdict 5 (L4): one retention rule for both logs under `<state>/log`. A day file is kept as it is for 2 days, then
// gzipped beside itself (`<day>.jsonl.gz`, 600) and the plain file removed; after 30 days it is deleted. The ops log's day files
// (`ops-<day>.jsonl`) and every project folder of the session log (`<slug>/<day>.jsonl`) follow it; Activity's rows live in the
// database, not here. The readers (`readOps`, `readEvents`) read a `.gz` day as they read a plain one. Run by the server at start
// and every night; one line when it changed something. Never throws.

export const LOG_GZIP_AFTER_DAYS = 2;
export const LOG_KEEP_DAYS = 30;

/** The ops log's day files sit at the top of the folder; the session log's inside each project folder. */
const OPS_DAY = /^ops-(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/;
const SESSION_DAY = /^(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/;
const dayBefore = (now: Date, days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

export interface RetentionResult { gzipped: number; deleted: number }

/** One folder's day files: older than `keepDays` deleted, older than `gzipAfterDays` gzipped. */
function retainDir(dir: string, day: RegExp, now: Date, keepDays: number, gzipAfterDays: number, out: RetentionResult): void {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  const deleteBefore = dayBefore(now, keepDays);
  const gzipBefore = dayBefore(now, gzipAfterDays);
  for (const name of names) {
    const m = day.exec(name);
    if (!m?.[1]) continue;
    const file = path.join(dir, name);
    try {
      if (m[1] < deleteBefore) {
        rmSync(file);
        out.deleted++;
      } else if (!m[2] && m[1] < gzipBefore) {
        const gz = `${file}.gz`;
        writeFileSync(gz, gzipSync(readFileSync(file)), { mode: 0o600 });
        rmSync(file);
        out.gzipped++;
      }
    } catch {
      // A file that cannot be read or removed now is tried again at the next run.
    }
  }
}

/**
 * Applies the rule to `<state>/log` (the ops day files at its top) and each of its project folders. `sessionKeepDays`: the
 * instance's `log.retention_days` may keep the session log shorter, never longer than 30 days.
 */
export function retainLogs(dir: string, o: { now?: Date; sessionKeepDays?: number } = {}): RetentionResult {
  const now = o.now ?? new Date();
  const out: RetentionResult = { gzipped: 0, deleted: 0 };
  try {
    retainDir(dir, OPS_DAY, now, LOG_KEEP_DAYS, LOG_GZIP_AFTER_DAYS, out);
    const sessionDays = Math.min(o.sessionKeepDays ?? LOG_KEEP_DAYS, LOG_KEEP_DAYS);
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { entries = []; }
    for (const e of entries) {
      const sub = path.join(dir, e);
      try { if (!statSync(sub).isDirectory()) continue; } catch { continue; }
      retainDir(sub, SESSION_DAY, now, sessionDays, LOG_GZIP_AFTER_DAYS, out);
    }
    if (out.gzipped || out.deleted) ops("server").info("logs: retention gzipped and deleted old day files", { gzipped: out.gzipped, deleted: out.deleted, keepDays: LOG_KEEP_DAYS });
  } catch {
    // Retention never stops the server.
  }
  return out;
}

/** Runs the rule now and then every 24 h until `stop()`; the timer never keeps the process alive. */
export function scheduleRetention(dir: string, o: { sessionKeepDays?: number; everyMs?: number } = {}): { stop: () => void } {
  retainLogs(dir, o);
  const t = setInterval(() => retainLogs(dir, o), o.everyMs ?? 24 * 3_600_000);
  t.unref();
  return { stop: () => clearInterval(t) };
}
