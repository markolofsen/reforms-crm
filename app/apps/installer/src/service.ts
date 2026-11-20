import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { appendStart, failuresSince, GUARD, guardOf, parseBootTime, readStarts, rotateLog, type AutostartFiles, type StartLine } from "@hub/config/autostart";
import type { HubPorts } from "@hub/config/paths";
import { healthy } from "./net";

// `hub up --service` (P67, decision 0033): what the LaunchAgent runs. It never loops launchd: the off file, a tripped guard and
// ports held by a hand-run are exit 0; a forwarded SIGTERM or SIGINT is exit 0 whatever the server answered; only a real crash is
// non-zero (launchd's `SuccessfulExit: false` restarts it after 30 s), and the fifth within 15 minutes trips the guard instead.

export interface ServiceDeps {
  /** `pnpm start` in core/app, in THIS process group (S0: launchd then cleans up the whole group after a `kill -9` of us). */
  start: (env: NodeJS.ProcessEnv) => ChildProcess;
  portBusy: (port: number) => Promise<boolean>;
  /** `GET /api/health` answers 200. */
  healthy: (port: number) => Promise<boolean>;
  bootAt: () => Promise<number | undefined>;
  now: () => number;
  out: (line: string) => void;
  onSignal: (handler: (sig: NodeJS.Signals) => void) => () => void;
  /** Signals our own process group (the server's tree included); falls back to the child alone when we lead no group. */
  signalGroup: (sig: NodeJS.Signals, child: ChildProcess) => void;
  readyEveryMs?: number;
  readyForMs?: number;
}

export const defaultServiceDeps = (app: string, portBusy: (port: number) => Promise<boolean>): ServiceDeps => ({
  start: (env) => spawn("pnpm", ["start"], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] }),
  portBusy,
  healthy,
  bootAt: async () => sysctlBootTime(),
  now: Date.now,
  out: (l) => console.log(l),
  onSignal: (h) => {
    process.on("SIGTERM", h);
    process.on("SIGINT", h);
    return () => {
      process.off("SIGTERM", h);
      process.off("SIGINT", h);
    };
  },
  signalGroup: (sig, child) => {
    try {
      process.kill(-process.pid, sig);
    } catch {
      child.kill(sig);
    }
  },
});

/** The last boot (`sysctl -n kern.boottime`), or undefined off macOS. */
export function sysctlBootTime(): number | undefined {
  try {
    return parseBootTime(execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8", timeout: 2000 }));
  } catch {
    return undefined;
  }
}

const stamp = (deps: ServiceDeps) => new Date(deps.now()).toISOString();

export async function runService(o: { files: AutostartFiles; ports: HubPorts; env: NodeJS.ProcessEnv }, deps: ServiceDeps): Promise<number> {
  const { files, ports } = o;
  const note = (line: Omit<StartLine, "at">) => appendStart(files.starts, { at: stamp(deps), ...line });
  const say = (l: string) => deps.out(`${stamp(deps)} hub up --service: ${l}`);
  if (rotateLog(files.log)) say(`rotated ${path.basename(files.log)} (over 5 MB) to ${path.basename(files.log)}.1`);
  if (existsSync(files.off)) {
    note({ event: "off" });
    say("autostart is switched off (state/autostart/off): not starting. Switch it on in the admin's Connections, or `hub autostart on`.");
    return 0;
  }
  const boot = await deps.bootAt();
  const g = guardOf(readStarts(files.starts), boot);
  if (g) {
    say(`stopped by the start guard at ${g.at} (${GUARD.failures} failed starts in 15 minutes): ${g.error}. Fix it, then \`./run.sh restart\`.`);
    return 0;
  }
  for (const [name, port] of [["admin", ports.admin], ["API", ports.api]] as const) {
    if (await deps.portBusy(port)) {
      note({ event: "standby", detail: `port ${port} (the ${name}) is taken` });
      say(`already running by hand: standing by (port ${port}, the ${name}, is taken); launchd takes over at the next restart.`);
      return 0;
    }
  }
  note({ event: "start" });
  say(`starting the admin on 127.0.0.1:${ports.admin} and the API on 127.0.0.1:${ports.api}`);
  const child = deps.start({ ...o.env, HUB_AUTOSTART: "1", HUB_ADMIN_PORT: String(ports.admin), HUB_PORT: String(ports.api) });
  let lastError = "";
  const tee = (stream: NodeJS.ReadableStream | null, write: (s: string) => void, keep: boolean) => {
    stream?.on("data", (b: Buffer) => {
      const s = b.toString();
      write(s);
      if (keep) for (const l of s.split("\n")) if (l.trim()) lastError = l.trim().slice(0, 300);
    });
  };
  tee(child.stdout, (s) => process.stdout.write(s), false);
  tee(child.stderr, (s) => process.stderr.write(s), true);
  let stopping: NodeJS.Signals | null = null;
  const off = deps.onSignal((sig) => {
    if (stopping) return; // our own group signal comes back to us: once is enough
    stopping = sig;
    say(`${sig}: stopping the server`);
    deps.signalGroup(sig, child);
  });
  let ready = false;
  const until = deps.now() + (deps.readyForMs ?? 5 * 60_000);
  const timer = setInterval(() => {
    if (ready || deps.now() > until) return clearInterval(timer);
    void deps.healthy(ports.api).then((ok) => {
      if (ok && !ready) {
        ready = true;
        clearInterval(timer);
        note({ event: "ready" });
        say(`ready → http://127.0.0.1:${ports.admin}`);
      }
    });
  }, deps.readyEveryMs ?? 2000);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: string }>((resolve) => {
    child.on("error", (e: NodeJS.ErrnoException) => resolve({ code: 127, signal: null, error: e.code === "ENOENT" ? "`pnpm` is not on the agent's PATH (rerun ./run.sh install --only autostart.agent)" : e.message }));
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  clearInterval(timer);
  off();
  if (stopping) {
    note({ event: "exit", code: 0, detail: `stopped by ${stopping}` });
    say("stopped");
    return 0;
  }
  const code = exit.code ?? 1;
  const detail = exit.error ?? (lastError || (exit.signal ? `killed by ${exit.signal}` : `exit ${code}`));
  note({ event: "exit", code, detail });
  if (code === 0) return 0;
  if (failuresSince(readStarts(files.starts), deps.now(), boot).length >= GUARD.failures) {
    note({ event: "guard", detail });
    say(`${GUARD.failures} failed starts in 15 minutes: not starting again until the next login or \`./run.sh restart\`. Last error: ${detail}`);
    return 0;
  }
  say(`the server exited ${code}: ${detail} (launchd starts it again in 30 s)`);
  return code;
}
