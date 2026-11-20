import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { HubPaths } from "@hub/config/paths";
import { isOpsLevel, isOpsSource, LEVEL_RANK, type OpsLevel, type OpsLine, type OpsSource } from "./line";

// Where the ops log lives and how it is written and read (P86). `<state>/log/ops-<YYYY-MM-DD>.jsonl` (UTC day), folder 700,
// file 600, one JSON line per event, append only, flat beside the agent log's project folders (whose readers list folders only).
// The writer never throws. The first write of a day deletes the files older than `keepDays`; a day file past `softCap` keeps
// only `error` lines (after one `warn` saying so), past `hardCap` nothing: the log never fills the disk.

export interface OpsStore {
  /** `<state>/log`. */
  dir: string;
  /** `state/secrets`: every stored value is masked from every line. */
  secrets: string;
  keepDays: number;
  softCap: number;
  hardCap: number;
}

export const OPS_KEEP_DAYS = 7;
export const OPS_SOFT_CAP = 20 * 1024 * 1024;
export const OPS_HARD_CAP = 25 * 1024 * 1024;

export const opsStoreOf = (paths: Pick<HubPaths, "opsLog" | "secrets">): OpsStore => ({ dir: paths.opsLog, secrets: paths.secrets, keepDays: OPS_KEEP_DAYS, softCap: OPS_SOFT_CAP, hardCap: OPS_HARD_CAP });

const OPS_FILE = /^ops-(\d{4}-\d{2}-\d{2})\.jsonl$/;
export const opsFileOf = (store: Pick<OpsStore, "dir">, day: string): string => path.join(store.dir, `ops-${day}.jsonl`);

/** Deletes the ops files older than `days` before `now`. Returns how many went. */
export function pruneOps(dir: string, days: number, now: Date): number {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  let n = 0;
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return 0; }
  for (const f of names) {
    const day = OPS_FILE.exec(f)?.[1];
    if (day && day < cutoff) {
      try { rmSync(path.join(dir, f)); n++; } catch { /* the next day tries again */ }
    }
  }
  return n;
}

/** What this process knows of the current day file: its size (re-read from disk every 200 lines, since other processes append too). */
const sizes = new Map<string, { bytes: number; writes: number; capped: boolean }>();

/** Appends one line. True when written. Never throws. */
export function appendOps(store: OpsStore, line: OpsLine, now: Date = new Date()): boolean {
  try {
    const file = opsFileOf(store, line.time.slice(0, 10));
    let st = sizes.get(file);
    if (!st || st.writes >= 200) {
      mkdirSync(store.dir, { recursive: true, mode: 0o700 });
      const fresh = !existsSync(file);
      if (fresh) pruneOps(store.dir, store.keepDays, now);
      const bytes = fresh ? 0 : statSync(file).size;
      st = { bytes, writes: 0, capped: st?.capped ?? false };
      sizes.set(file, st);
    }
    let text = JSON.stringify(line) + "\n";
    if (st.bytes >= store.hardCap) return false;
    if (st.bytes >= store.softCap) {
      if (line.level !== "error") {
        if (st.capped) return false;
        st.capped = true;
        text = JSON.stringify({ time: line.time, level: "warn", source: "server", message: `ops log: this day's file passed ${Math.round(store.softCap / 1024 / 1024)} MB; only error lines are kept until tomorrow` } satisfies OpsLine) + "\n";
      }
    }
    const created = st.bytes === 0 && !existsSync(file);
    appendFileSync(file, text, { mode: 0o600 });
    if (created) chmodSync(file, 0o600);
    st.bytes += Buffer.byteLength(text);
    st.writes++;
    return true;
  } catch {
    return false;
  }
}

export interface OpsFilter {
  /** The lowest level shown: `warn` shows warn and error. */
  level?: OpsLevel;
  sources?: readonly OpsSource[];
  /** ISO time, inclusive. */
  since?: string;
  /** The newest this many, still oldest first. */
  limit?: number;
}

/** Every line that matches, oldest first. A torn or foreign line is skipped. */
export function readOps(store: Pick<OpsStore, "dir">, f: OpsFilter = {}): OpsLine[] {
  const fromDay = f.since ? f.since.slice(0, 10) : "";
  let names: string[] = [];
  try { names = readdirSync(store.dir).filter((x) => { const d = OPS_FILE.exec(x)?.[1]; return !!d && d >= fromDay; }).sort(); } catch { return []; }
  const min = f.level ? LEVEL_RANK[f.level] : LEVEL_RANK.debug;
  const out: OpsLine[] = [];
  for (const name of names) {
    let text = "";
    try { text = readFileSync(path.join(store.dir, name), "utf8"); } catch { continue; }
    for (const l of text.split("\n")) {
      if (!l.trim()) continue;
      let raw: unknown;
      try { raw = JSON.parse(l); } catch { continue; }
      const line = opsLineOf(raw);
      if (!line) continue;
      if (LEVEL_RANK[line.level] < min) continue;
      if (f.sources?.length && !f.sources.includes(line.source)) continue;
      if (f.since && line.time < f.since) continue;
      out.push(line);
    }
  }
  out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return f.limit !== undefined && out.length > f.limit ? out.slice(out.length - f.limit) : out;
}

/** A parsed JSON value as an ops line, or null. */
export function opsLineOf(raw: unknown): OpsLine | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const time: unknown = Reflect.get(raw, "time");
  const level: unknown = Reflect.get(raw, "level");
  const source: unknown = Reflect.get(raw, "source");
  const message: unknown = Reflect.get(raw, "message");
  const fields: unknown = Reflect.get(raw, "fields");
  if (typeof time !== "string" || !isOpsLevel(level) || !isOpsSource(source) || typeof message !== "string") return null;
  const line: OpsLine = { time, level, source, message };
  if (fields && typeof fields === "object" && !Array.isArray(fields)) line.fields = fields as Record<string, unknown>;
  return line;
}

/** The day files' sizes and times, for the server's live topic. */
export function opsSignature(store: Pick<OpsStore, "dir">): string {
  try {
    return readdirSync(store.dir).filter((x) => OPS_FILE.test(x)).sort().slice(-1).map((n) => { const s = statSync(path.join(store.dir, n)); return `${n}:${s.size}:${s.mtimeMs}`; }).join("|");
  } catch {
    return "";
  }
}
