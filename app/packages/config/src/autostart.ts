import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { HubPaths } from "./paths";

// P67 (decision 0033): the Hub's server starts at login through one per-user LaunchAgent per instance. This module is the one
// owner of its names, its files and how its state is read and switched, shared by the installer (the `autostart.agent` step,
// `hub up --service`, `hub stop|restart|autostart`) and the server (`/api/instance/autostart`). Every launchctl call is one argv
// through an injected runner: no shell, and tests never reach launchd.

export const LABEL_PREFIX = "com.reforms.hub.";

/** `com.reforms.hub.<instance folder name>`; characters launchd labels should not carry become `-`. Derived from the instance, never asked for. */
export const autostartLabel = (paths: Pick<HubPaths, "home">): string => `${LABEL_PREFIX}${basename(paths.home).replace(/[^A-Za-z0-9._-]/g, "-")}`;

/** The user's LaunchAgents folder: `~/Library/LaunchAgents`. */
export const launchAgentsDir = (userHome: string): string => join(userHome, "Library", "LaunchAgents");

export interface AutostartFiles {
  label: string;
  /** `<agents dir>/<label>.plist`, written only by the installer. */
  plist: string;
  /** `<state>/autostart/`. */
  dir: string;
  /** What launchd writes the job's stdout and stderr to (`StandardOutPath`). */
  log: string;
  /** One JSON line per start, ready, exit, stand-by and guard of `hub up --service` (the last 200). */
  starts: string;
  /** Present while autostart is switched off: `--service` then exits 0 at once (S0: launchd respawns a crash even while disabled). */
  off: string;
}

export function autostartFiles(paths: Pick<HubPaths, "home" | "autostart">, agentsDir: string): AutostartFiles {
  const label = autostartLabel(paths);
  return { label, plist: join(agentsDir, `${label}.plist`), dir: paths.autostart, log: join(paths.autostart, "launchd.log"), starts: join(paths.autostart, "starts.jsonl"), off: join(paths.autostart, "off") };
}

// ---- starts.jsonl ----

export type StartEvent = "start" | "ready" | "exit" | "standby" | "off" | "guard" | "reset";
export interface StartLine {
  at: string;
  event: StartEvent;
  code?: number;
  detail?: string;
}

const EVENTS: readonly string[] = ["start", "ready", "exit", "standby", "off", "guard", "reset"];
export const STARTS_KEPT = 200;
/** Five failed starts within fifteen minutes stop the job until the next login (or `hub restart`). */
export const GUARD = { failures: 5, windowMs: 15 * 60_000 } as const;

export function readStarts(file: string): StartLine[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: StartLine[] = [];
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l) as Partial<StartLine>;
      if (typeof j.at === "string" && typeof j.event === "string" && EVENTS.includes(j.event)) out.push(j as StartLine);
    } catch {
      /* a torn line is skipped */
    }
  }
  return out;
}

/** Appends one line; past {@link STARTS_KEPT} lines the file is rewritten with the newest ones. */
export function appendStart(file: string, line: StartLine, keep = STARTS_KEPT): void {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, `${JSON.stringify(line)}\n`);
  const all = readStarts(file);
  if (all.length > keep) writeFileSync(file, all.slice(-keep).map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const ms = (l: StartLine) => Date.parse(l.at);
/** Lines that count now: after the boot and after the last `reset` (a `hub restart` after a fix). */
const current = (lines: StartLine[], bootAtMs = 0): StartLine[] => {
  const reset = Math.max(bootAtMs, ...lines.filter((l) => l.event === "reset").map(ms));
  return lines.filter((l) => ms(l) >= reset && l.event !== "reset");
};

/** The failed starts (exit with a non-zero code) within the guard window, since the boot and the last reset. */
export const failuresSince = (lines: StartLine[], nowMs: number, bootAtMs = 0): StartLine[] =>
  current(lines, bootAtMs).filter((l) => l.event === "exit" && (l.code ?? 1) !== 0 && nowMs - ms(l) <= GUARD.windowMs);

/** The tripped guard of this boot, or null. */
export function guardOf(lines: StartLine[], bootAtMs = 0): { at: string; error: string } | null {
  const g = current(lines, bootAtMs).filter((l) => l.event === "guard").at(-1);
  return g ? { at: g.at, error: g.detail ?? "no error line" } : null;
}

/** The last time `--service` ran at all (a start, or a stand-by beside a hand-run, or the off file). */
export const lastStartOf = (lines: StartLine[]): StartLine | undefined => lines.filter((l) => l.event === "start" || l.event === "standby" || l.event === "off").at(-1);

/** `sysctl -n kern.boottime` (`{ sec = 1763540000, usec = 12 } Wed Nov 19 ...`) as epoch milliseconds. */
export function parseBootTime(out: string): number | undefined {
  const m = /sec\s*=\s*(\d+)/.exec(out);
  return m ? Number(m[1]) * 1000 : undefined;
}

export const LOG_ROTATE_BYTES = 5 * 1024 * 1024;
export const LOG_WARN_BYTES = 10 * 1024 * 1024;

/**
 * Over `maxBytes`, the log is copied to `<log>.1` (one kept) and truncated in place: launchd holds it open for appending, so a
 * rename would leave the job writing into `.1`. True when it rotated.
 */
export function rotateLog(file: string, maxBytes = LOG_ROTATE_BYTES): boolean {
  try {
    if (statSync(file).size <= maxBytes) return false;
    copyFileSync(file, `${file}.1`);
    truncateSync(file, 0);
    return true;
  } catch {
    return false;
  }
}

export const logBytes = (file: string): number => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

// ---- launchctl ----

/** One argv per launchctl verb this core uses. `gui/<uid>` is the owner's login session. */
export const launchctlArgv = {
  print: (uid: number, label: string) => ["print", `gui/${uid}/${label}`],
  printDisabled: (uid: number) => ["print-disabled", `gui/${uid}`],
  enable: (uid: number, label: string) => ["enable", `gui/${uid}/${label}`],
  disable: (uid: number, label: string) => ["disable", `gui/${uid}/${label}`],
  bootstrap: (uid: number, plist: string) => ["bootstrap", `gui/${uid}`, plist],
  bootout: (uid: number, label: string) => ["bootout", `gui/${uid}/${label}`],
  kickstart: (uid: number, label: string, restart = false) => ["kickstart", ...(restart ? ["-k"] : []), `gui/${uid}/${label}`],
  kill: (uid: number, label: string, signal = "SIGTERM") => ["kill", signal, `gui/${uid}/${label}`],
} as const;

export interface JobState {
  loaded: boolean;
  running: boolean;
  pid?: number;
}

/** `launchctl print gui/<uid>/<label>`: exit 0 = loaded; `state = running` and `pid = N` say it runs. */
export function parsePrint(code: number, stdout: string): JobState {
  if (code !== 0) return { loaded: false, running: false };
  const pid = /^\s*pid = (\d+)/m.exec(stdout);
  const running = /^\s*state = running/m.test(stdout);
  return { loaded: true, running, ...(pid ? { pid: Number(pid[1]) } : {}) };
}

/** `launchctl print-disabled gui/<uid>`: `"<label>" => disabled` (older macOS: `=> true`). A label not listed is enabled. */
export function parseDisabled(stdout: string, label: string): boolean {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`"${esc}"\\s*=>\\s*(disabled|true)`).test(stdout);
}

export type LaunchctlRun = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface AutostartState {
  label: string;
  /** The plist exists in the LaunchAgents folder. */
  installed: boolean;
  /** Neither disabled in launchd nor switched off by the off file. */
  enabled: boolean;
  loaded: boolean;
  running: boolean;
  pid?: number;
  lastStart?: StartLine;
  guard: { at: string; error: string } | null;
}

/** Reads the state in two launchctl calls (`print`, `print-disabled`) and the files. Read only. */
export async function readAutostart(run: LaunchctlRun, files: AutostartFiles, uid: number, bootAtMs?: number): Promise<AutostartState> {
  const [p, d] = await Promise.all([run(launchctlArgv.print(uid, files.label)), run(launchctlArgv.printDisabled(uid))]);
  const job = parsePrint(p.code, p.stdout);
  const lines = readStarts(files.starts);
  const lastStart = lastStartOf(lines);
  return {
    label: files.label,
    installed: existsSync(files.plist),
    enabled: !parseDisabled(d.stdout, files.label) && !existsSync(files.off),
    ...job,
    ...(lastStart ? { lastStart } : {}),
    guard: guardOf(lines, bootAtMs),
  };
}

export class AutostartRefusal extends Error {}

/**
 * Off: `launchctl disable` and the off file; the job is never booted out or killed, so the server that answers keeps running.
 * On: `launchctl enable`, the off file removed, and `bootstrap` only when the agent is not loaded. Refused without a plist: only
 * the installer writes one. Returns the argv it ran, in order.
 */
export async function switchAutostart(run: LaunchctlRun, files: AutostartFiles, uid: number, on: boolean): Promise<string[][]> {
  if (!existsSync(files.plist)) throw new AutostartRefusal(`not set up: ${AUTOSTART_FIX}`);
  const ran: string[][] = [];
  const call = async (args: string[]) => {
    ran.push(args);
    const r = await run(args);
    if (r.code !== 0) throw new Error(`launchctl ${args[0]} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().split("\n")[0] ?? ""}`);
    return r;
  };
  if (!on) {
    mkdirSync(files.dir, { recursive: true });
    writeFileSync(files.off, `switched off ${new Date().toISOString()}\n`);
    await call(launchctlArgv.disable(uid, files.label));
    return ran;
  }
  await call(launchctlArgv.enable(uid, files.label));
  rmSync(files.off, { force: true });
  const p = await run(launchctlArgv.print(uid, files.label));
  if (!parsePrint(p.code, p.stdout).loaded) await call(launchctlArgv.bootstrap(uid, files.plist));
  return ran;
}

/** The one line that sets autostart up (the installer step). */
export const AUTOSTART_FIX = "./run.sh install --only autostart.agent";
