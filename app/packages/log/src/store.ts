import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { instanceLogRetention, type HubPaths } from "@hub/config/paths";
import { logEvent, type LogCli, type LogEvent, type LogKind, type NewLogEvent } from "./event";
import { LINE_CAP, redactData } from "./privacy";

// Where the log lives and how it is written and read (P54 section 3, points 8 and 9). `<state>/log/<slug>/<YYYY-MM-DD>.jsonl`
// (UTC day), folder 700, file 600, one JSON line per event, append only. The writer never throws: a hook must never stop
// or slow a session. The first write of a day deletes that project's files older than the retention.

export interface LogStore {
  /** `<state>/log`. */
  dir: string;
  /** `state/secrets`: every value there is redacted from every line. */
  secrets: string;
  /** Days kept (`log.retention_days`, default 90). */
  retentionDays: number;
}

export const logStoreOf = (paths: Pick<HubPaths, "log" | "secrets" | "configFile">): LogStore => ({ dir: paths.log, secrets: paths.secrets, retentionDays: instanceLogRetention(paths) });

/** The folder of one project's log; an unbound session writes `_unbound`. */
export const UNBOUND = "_unbound";
const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "_";
export const projectDir = (store: LogStore, project: string | null): string => path.join(store.dir, safe(project ?? UNBOUND));
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
export const dayOf = (iso: string): string => iso.slice(0, 10);

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Deletes the day files of one project older than `days` before `now`. Returns how many went. */
export function prune(dir: string, days: number, now: Date): number {
  let n = 0;
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return 0; }
  for (const f of names) {
    const day = DAY_FILE.exec(f)?.[1];
    if (day && day < cutoff) {
      try { rmSync(path.join(dir, f)); n++; } catch { /* the next day tries again */ }
    }
  }
  return n;
}

/** The line as written: stamped, redacted, capped. Exported for tests. */
export function lineOf(store: LogStore, e: NewLogEvent, now: Date): LogEvent {
  const base: LogEvent = { v: 1, ts: e.ts ?? now.toISOString(), project: e.project, session: e.session, cli: e.cli, kind: e.kind, data: redactData(store.secrets, e.data) };
  if (e.turn) base.turn = e.turn;
  if (e.corr) base.corr = e.corr;
  if (e.agent) base.agent = e.agent;
  const bytes = Buffer.byteLength(JSON.stringify(base));
  return bytes > LINE_CAP ? { ...base, data: { truncated: true, bytes } } : base;
}

/** Appends events (one hook may write two: a prompt and its focus line). True when written. Never throws. */
export function appendEvents(store: LogStore, events: readonly NewLogEvent[], now: Date = new Date()): boolean {
  try {
    const byFile = new Map<string, string[]>();
    for (const e of events) {
      const line = lineOf(store, e, now);
      const file = path.join(projectDir(store, e.project), `${dayOf(line.ts)}.jsonl`);
      byFile.set(file, [...(byFile.get(file) ?? []), JSON.stringify(line)]);
    }
    for (const [file, lines] of byFile) {
      const dir = path.dirname(file);
      ensureDir(dir);
      const fresh = !existsSync(file);
      if (fresh) prune(dir, store.retentionDays, now);
      appendFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
      if (fresh) chmodSync(file, 0o600);
    }
    return events.length > 0;
  } catch {
    return false;
  }
}

export const appendEvent = (store: LogStore, e: NewLogEvent, now?: Date): boolean => appendEvents(store, [e], now);

export interface LogFilter {
  /** One project (a slug, or `_unbound`); all projects when absent. */
  project?: string;
  /** A session id, or a prefix of one (8 characters are shown). */
  session?: string;
  kinds?: readonly LogKind[];
  cli?: LogCli;
  /** ISO time, inclusive. */
  since?: string;
  until?: string;
}

/** Projects that have a log. */
export function loggedProjects(store: LogStore): string[] {
  try { return readdirSync(store.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; }
}

/** Every event that matches, oldest first. A torn or foreign line is skipped. */
export function readEvents(store: LogStore, f: LogFilter = {}): LogEvent[] {
  const out: LogEvent[] = [];
  const fromDay = f.since ? dayOf(f.since) : "";
  const toDay = f.until ? dayOf(f.until) : "9999";
  for (const p of f.project ? [safe(f.project)] : loggedProjects(store)) {
    const dir = path.join(store.dir, p);
    let files: string[] = [];
    try { files = readdirSync(dir).filter((x) => { const d = DAY_FILE.exec(x)?.[1]; return !!d && d >= fromDay && d <= toDay; }).sort(); } catch { continue; }
    for (const file of files) {
      let text = "";
      try { text = readFileSync(path.join(dir, file), "utf8"); } catch { continue; }
      for (const l of text.split("\n")) {
        if (!l.trim()) continue;
        let raw: unknown;
        try { raw = JSON.parse(l); } catch { continue; }
        const r = logEvent.safeParse(raw);
        if (!r.success) continue;
        const e = r.data;
        if (f.session && !e.session.startsWith(f.session)) continue;
        if (f.kinds?.length && !f.kinds.includes(e.kind)) continue;
        if (f.cli && e.cli !== f.cli) continue;
        if (f.since && e.ts < f.since) continue;
        if (f.until && e.ts > f.until) continue;
        out.push(e);
      }
    }
  }
  return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
