import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { CLOSE, clampSize, MAX_SESSIONS, type ServerFrame, type TerminalPreset, type TerminalSessionDto } from "@hub/contract/terminal";
import type { PtyProcess, PtySpawn } from "./pty";

// Sessions of the embedded terminal (P49 section 4). A session lives until its process exits, its tab is closed, or the
// server stops; closing the column or the page only detaches. Each feeds a headless xterm (5 000 lines), so an attach gets
// the screen as it is (a raw byte replay could start mid escape sequence), then the live stream. One viewer at a time.

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

/** What a socket must offer a session; the server adapts `ws` to it, tests pass a fake. */
export interface Viewer {
  sendText(frame: ServerFrame): void;
  sendBinary(data: Buffer): void;
  bufferedAmount(): number;
  close(code: number, reason?: string): void;
}

export interface SpawnSpec {
  preset: TerminalPreset;
  project: string | null;
  title: string;
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface ManagerOptions {
  spawn: PtySpawn;
  now?: () => Date;
  /** Output batching (default 16 ms) and the flow-control marks (pause above 1 MB queued in the socket, resume below 256 KB). */
  batchMs?: number;
  highWater?: number;
  lowWater?: number;
  /** SIGHUP, then SIGKILL after this (default 3 s). */
  killGraceMs?: number;
  scrollback?: number;
  /** A session's program ended (P57: the server re-detects the CLIs, he may have installed or signed in inside it). */
  onExit?: (session: TerminalSessionDto) => void;
}

interface Session {
  id: string;
  spec: SpawnSpec;
  pty: PtyProcess;
  term: InstanceType<typeof Terminal>;
  serializer: InstanceType<typeof SerializeAddon>;
  viewer: Viewer | null;
  pending: string;
  timer: ReturnType<typeof setTimeout> | null;
  paused: boolean;
  exitCode: number | null;
  exited: boolean;
  createdAt: string;
  cols: number;
  rows: number;
}

export class SessionLimitError extends Error {}

export function sessionManager(o: ManagerOptions) {
  const sessions = new Map<string, Session>();
  const batchMs = o.batchMs ?? 16;
  const high = o.highWater ?? 1_048_576;
  const low = o.lowWater ?? 262_144;

  const dto = (s: Session): TerminalSessionDto => ({ id: s.id, title: s.spec.title, preset: s.spec.preset, project: s.spec.project, state: s.exited ? "exited" : "running", exitCode: s.exitCode, createdAt: s.createdAt });

  /** Sends what is queued; never a blocking write: a slow browser pauses the PTY instead. */
  const flush = (s: Session) => {
    s.timer = null;
    const v = s.viewer;
    if (v && s.pending) {
      v.sendBinary(Buffer.from(s.pending, "utf8"));
      s.pending = "";
    }
    if (v && !s.paused && v.bufferedAmount() > high) { s.pty.pause(); s.paused = true; }
    if (s.paused && (!v || v.bufferedAmount() < low)) { s.pty.resume(); s.paused = false; }
    if (s.paused) s.timer = setTimeout(() => flush(s), batchMs);
  };

  function create(spec: SpawnSpec, size = { cols: 80, rows: 24 }): TerminalSessionDto {
    const live = [...sessions.values()].filter((s) => !s.exited).length;
    if (live >= MAX_SESSIONS) throw new SessionLimitError(`at most ${MAX_SESSIONS} terminal sessions: close one first`);
    const cols = clampSize(size.cols);
    const rows = clampSize(size.rows);
    const pty = o.spawn(spec.file, spec.args, { cols, rows, cwd: spec.cwd, env: spec.env });
    const term = new Terminal({ cols, rows, scrollback: o.scrollback ?? 5000, allowProposedApi: true });
    const serializer = new SerializeAddon();
    term.loadAddon(serializer);
    const s: Session = { id: randomBytes(9).toString("base64url"), spec, pty, term, serializer, viewer: null, pending: "", timer: null, paused: false, exitCode: null, exited: false, createdAt: (o.now?.() ?? new Date()).toISOString(), cols, rows };
    pty.onData((d) => {
      term.write(d);
      if (!s.viewer) return;
      s.pending += d;
      if (!s.timer) s.timer = setTimeout(() => flush(s), batchMs);
    });
    pty.onExit((e) => {
      s.exited = true;
      s.exitCode = e.exitCode;
      if (s.timer) clearTimeout(s.timer);
      flush(s);
      s.viewer?.sendText({ op: "exit", code: e.exitCode });
      o.onExit?.(dto(s));
    });
    sessions.set(s.id, s);
    return dto(s);
  }

  /** The screen and scrollback as an escape string, after every write so far has been applied. */
  const snapshot = (s: Session): Promise<string> => new Promise((resolve) => s.term.write("", () => resolve(s.serializer.serialize())));

  /** A second viewer takes the session; the first is told and closed. Returns the detach function, or null for an unknown id. */
  async function attach(id: string, v: Viewer): Promise<(() => void) | null> {
    const s = sessions.get(id);
    if (!s) return null;
    const prev = s.viewer;
    s.viewer = v;
    if (prev) { prev.sendText({ op: "taken" }); prev.close(CLOSE.taken, "opened in another window"); }
    s.pending = "";
    v.sendText({ op: "ready", session: id });
    v.sendBinary(Buffer.from(await snapshot(s), "utf8"));
    if (s.exited) v.sendText({ op: "exit", code: s.exitCode });
    return () => { if (s.viewer === v) s.viewer = null; flush(s); };
  }

  function input(id: string, data: string): void {
    const s = sessions.get(id);
    if (s && !s.exited) s.pty.write(data);
  }

  function resize(id: string, cols: number, rows: number): void {
    const s = sessions.get(id);
    if (!s || s.exited) return;
    const c = clampSize(cols);
    const r = clampSize(rows);
    if (c === s.cols && r === s.rows) return;
    s.cols = c;
    s.rows = r;
    s.pty.resize(c, r);
    s.term.resize(c, r);
  }

  /** Closes a tab: SIGHUP to the process group, SIGKILL after the grace period; the session is forgotten at once. */
  function kill(id: string): boolean {
    const s = sessions.get(id);
    if (!s) return false;
    sessions.delete(id);
    if (s.timer) clearTimeout(s.timer);
    s.viewer?.close(CLOSE.notFound, "closed");
    if (!s.exited) {
      s.pty.kill("SIGHUP");
      const t = setTimeout(() => { if (!s.exited) s.pty.kill("SIGKILL"); }, o.killGraceMs ?? 3000);
      t.unref?.();
    }
    s.term.dispose();
    return true;
  }

  return {
    create,
    attach,
    input,
    resize,
    kill,
    has: (id: string) => sessions.has(id),
    list: (): TerminalSessionDto[] => [...sessions.values()].map(dto),
    /** Server shutdown: every session ends. */
    killAll: () => { for (const id of [...sessions.keys()]) kill(id); },
  };
}
export type SessionManager = ReturnType<typeof sessionManager>;
