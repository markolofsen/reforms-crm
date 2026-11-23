import { createRequire } from "node:module";
import path from "node:path";
import { ensureSpawnHelper, nodePtyRoot } from "./readiness";
import type * as NodePty from "node-pty";

// The PTY behind an interface, so tests run on a fake (like the fake Mailer). Node has no PTY of its own and
// `child_process` pipes break every TUI (no size, no raw mode): node-pty 1.1.0 is the one native dependency (P49).

export interface PtyOptions { cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }

export interface PtyProcess {
  readonly pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number | null; signal?: number | null }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Signal the whole process group (the shell and what it started). */
  kill(signal: NodeJS.Signals): void;
  pause(): void;
  resume(): void;
}

export type PtySpawn = (file: string, args: string[], o: PtyOptions) => PtyProcess;

/**
 * The real PTY (node-pty) from the core's node-pty folder (`nodePtyRoot`). The server has already set the helper's bit at
 * start (`ensureSpawnHelper`, P66); it is set again here so a helper that lost it since still spawns.
 */
export function nodePty(root: string | null = nodePtyRoot()): PtySpawn {
  if (!root) throw new Error("node-pty is not installed in the core");
  ensureSpawnHelper(root);
  const pty = createRequire(path.join(root, "package.json"))(root) as typeof NodePty;
  return (file, args, o) => {
    const p = pty.spawn(file, args, { name: "xterm-256color", cols: o.cols, rows: o.rows, cwd: o.cwd, env: o.env as Record<string, string> });
    return {
      pid: p.pid,
      onData: (cb) => void p.onData(cb),
      onExit: (cb) => void p.onExit((e) => cb({ exitCode: e.exitCode, signal: e.signal ?? null })),
      write: (d) => p.write(d),
      resize: (c, r) => p.resize(c, r),
      kill: (signal) => {
        // node-pty's child leads its own session, so its pid is the group id.
        try { process.kill(-p.pid, signal); } catch { try { p.kill(signal); } catch { /* already gone */ } }
      },
      pause: () => p.pause(),
      resume: () => p.resume(),
    };
  };
}
