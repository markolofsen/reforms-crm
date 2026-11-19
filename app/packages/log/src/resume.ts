import { closeSync, existsSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { isLogCli, type LogCli, type LogEvent } from "./event";
import { readEvents, UNBOUND, type LogStore } from "./store";

// Which session the dock continues after a restart (P64). The source is the session log itself (P54): every session start
// carries its id and the native transcript's path, per project folder and CLI. No second store.

/** A session older than this (by its last event) is not resumed: a fresh start is the better default after a day. */
export const RESUME_MAX_AGE_MS = 24 * 3_600_000;

/** The id format both CLIs use (Claude a v4 UUID, Codex a v7 one): the only thing `hub agent --resume` accepts. */
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface LoggedSession {
  session: string;
  cli: LogCli;
  project: string | null;
  startedAt: string;
  /** The newest event of the session, any kind. */
  lastAt: string;
  /** The native transcript (Claude) or rollout (Codex) the newest `session` event named; null when none did. */
  transcript: string | null;
  prompts: number;
}

export interface ResumeQuery {
  project: string | null;
  cli: LogCli;
  now?: Date;
  /** Default {@link RESUME_MAX_AGE_MS}; `Infinity`: no cut-off (`hub agent continue`). */
  maxAgeMs?: number;
  /** Codex: the rollout must lie under this folder (that project's `CODEX_HOME`). */
  within?: string;
  exists?: (file: string) => boolean;
}

const folderOf = (project: string | null): string => project ?? UNBOUND;

/** Groups one project's events of one CLI by session. Only events whose `project` is that project count (isolation). */
function sessionsOf(events: readonly LogEvent[], project: string | null, cli: LogCli): Map<string, LoggedSession> {
  const by = new Map<string, LoggedSession>();
  for (const e of events) {
    if (e.project !== project || e.cli !== cli) continue;
    let s = by.get(e.session);
    if (!s) { s = { session: e.session, cli, project, startedAt: e.ts, lastAt: e.ts, transcript: null, prompts: 0 }; by.set(e.session, s); }
    if (e.ts < s.startedAt) s.startedAt = e.ts;
    if (e.ts > s.lastAt) s.lastAt = e.ts;
    if (e.kind === "prompt") s.prompts++;
    if (e.kind === "session" && typeof e.data.transcript === "string" && e.data.transcript) s.transcript = e.data.transcript;
  }
  return by;
}

const inside = (file: string, dir: string): boolean => {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Why a logged session cannot be resumed, or null when it can. */
export function refusal(s: LoggedSession, q: Pick<ResumeQuery, "within" | "exists">): string | null {
  const exists = q.exists ?? existsSync;
  if (!SESSION_ID.test(s.session)) return "its id is not a session id";
  if (s.prompts === 0) return "it has no prompt";
  if (!s.transcript) return "the log names no transcript for it";
  if (q.within && !inside(s.transcript, q.within)) return "its transcript is outside this project's home";
  if (!exists(s.transcript)) return "its transcript is gone";
  return null;
}

/** One session id of this project and CLI as the log knows it (the whole history), or null when the log does not have it. */
export function loggedSession(store: LogStore, project: string | null, cli: LogCli, id: string): LoggedSession | null {
  if (!isLogCli(cli) || !SESSION_ID.test(id)) return null;
  return sessionsOf(readEvents(store, { project: folderOf(project), session: id, cli }), project, cli).get(id) ?? null;
}

/**
 * The session the dock resumes: of this project and CLI only, the newest by its last event within the cut-off, with at least
 * one prompt (the idle session an automatic start left is skipped) and a transcript that still exists. Null: start fresh.
 */
export function resumableSession(store: LogStore, q: ResumeQuery): LoggedSession | null {
  const now = q.now ?? new Date();
  const max = q.maxAgeMs ?? RESUME_MAX_AGE_MS;
  const since = Number.isFinite(max) ? new Date(now.getTime() - max).toISOString() : undefined;
  const recent = sessionsOf(readEvents(store, { project: folderOf(q.project), cli: q.cli, ...(since ? { since } : {}) }), q.project, q.cli);
  const newest = [...recent.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  for (const r of newest) {
    // A session that started before the window has its start (and maybe its prompts) outside it: read its whole history.
    const s = r.transcript && r.prompts ? r : (loggedSession(store, q.project, q.cli, r.session) ?? r);
    if (refusal(s, q) === null) return { ...s, lastAt: r.lastAt };
  }
  return null;
}

/** The first developer instruction text a Codex rollout recorded (the session's binding prompt), or null. Reads the head only. */
export function rolloutInstructions(file: string, maxBytes = 1_048_576): string | null {
  let text = "";
  try {
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const n = readSync(fd, buf, 0, maxBytes, 0);
      text = buf.subarray(0, n).toString("utf8");
    } finally { closeSync(fd); }
  } catch { return null; }
  for (const line of text.split("\n")) {
    if (!line.includes('"developer"')) continue;
    try {
      const j = JSON.parse(line) as { type?: string; payload?: { type?: string; role?: string; content?: Array<{ type?: string; text?: unknown }> } };
      const p = j.payload;
      if (j.type !== "response_item" || p?.type !== "message" || p.role !== "developer") continue;
      const first = p.content?.find((c) => c.type === "input_text" && typeof c.text === "string");
      return first ? String(first.text) : null;
    } catch { /* a torn last line */ }
  }
  return null;
}

/** The line a Codex session that cannot be resumed for its rules says (P64: Codex keeps the instructions it started with). */
export const CODEX_RULES_CHANGED = "Codex keeps the rules a session started with, and the hub's rules for this project changed since";

export type ResumeChoice = { session: LoggedSession; why: null } | { session: null; why: string | null };

/**
 * The one decision, for the server's automatic start and for `hub agent` (P64). Without `id`: the project's last resumable
 * session of this CLI, or none (`why` null: nothing to resume). With `id`: that session, when the log has it for this project
 * and CLI and it can still be resumed. Codex also needs `instructions` equal to the rollout's first developer message.
 */
export function chooseResume(store: LogStore, q: ResumeQuery & { id?: string; instructions?: string }): ResumeChoice {
  let s: LoggedSession | null;
  if (q.id) {
    s = loggedSession(store, q.project, q.cli, q.id);
    if (!s) return { session: null, why: `the log has no ${q.cli} session ${q.id.slice(0, 8)} of ${q.project ?? "an unbound session"}` };
    const no = refusal(s, q);
    if (no) return { session: null, why: no };
  } else {
    s = resumableSession(store, q);
    if (!s) return { session: null, why: null };
  }
  if (q.cli === "codex" && (q.instructions === undefined || !s.transcript || rolloutInstructions(s.transcript) !== q.instructions)) return { session: null, why: CODEX_RULES_CHANGED };
  return { session: s, why: null };
}
