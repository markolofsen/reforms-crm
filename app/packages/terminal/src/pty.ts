import { accessSync, chmodSync, constants, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

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

const require = createRequire(import.meta.url);

/**
 * node-pty 1.1.0 ships `prebuilds/darwin-*\/spawn-helper` without the execute bit when pnpm unpacks it, and every
 * spawn then fails with "posix_spawnp failed" (measured 2026-11-18). The server sets the bit once before the first spawn.
 * Returns the helper's path, or null when there is none for this platform (node-gyp built it into build/Release).
 */
export function ensureSpawnHelper(): string | null {
  const root = path.dirname(require.resolve("node-pty/package.json"));
  const helper = path.join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  if (!existsSync(helper)) return null;
  try { accessSync(helper, constants.X_OK); } catch { chmodSync(helper, statSync(helper).mode | 0o111); }
  return helper;
}

/** The real PTY (node-pty), loaded only when the terminal is on: an instance with it off never loads the native module. */
export function nodePty(): PtySpawn {
  ensureSpawnHelper();
  const pty = require("node-pty") as typeof import("node-pty");
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
