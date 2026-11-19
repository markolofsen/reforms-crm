import { existsSync } from "node:fs";
import { appendStart, AUTOSTART_FIX, readAutostart, switchAutostart, AutostartRefusal, type AutostartState } from "@hub/config/autostart";
import { instancePorts } from "@hub/config/paths";
import { filesOf } from "./autostart";
import type { Ctx } from "./context";
import { kickstart, killJob, launchctlOf, printJob } from "./launchctl";
import { adminUrl } from "./net";
import { bootTime } from "./steps/autostart";
import { c } from "./term";

// P67: the owner's commands around the LaunchAgent. `hub up` by hand finds a launchd-owned server instead of starting a second
// one; `hub stop`, `hub restart` and `hub autostart [status|on|off]` are one line each.

export interface CommandDeps {
  platform?: NodeJS.Platform;
  /** `GET /api/health` answers 200 on this port. */
  healthy: (port: number) => Promise<boolean>;
  portBusy: (port: number) => Promise<boolean>;
  /** Opens the admin (the P61 opener); absent with `--no-open`. */
  open?: (url: string) => Promise<void>;
  out?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const wait = async (deps: CommandDeps, ok: () => Promise<boolean>, forMs: number): Promise<boolean> => {
  const now = deps.now ?? Date.now;
  const until = now() + forMs;
  for (;;) {
    if (await ok()) return true;
    if (now() >= until) return false;
    await (deps.sleep ?? sleepMs)(1000);
  }
};

/** The state, or null when launchd is not in play here (not macOS, no plist). */
async function stateOf(ctx: Ctx, deps: CommandDeps): Promise<AutostartState | null> {
  if ((deps.platform ?? process.platform) !== "darwin") return null;
  const f = filesOf(ctx);
  if (!existsSync(f.plist)) return null;
  return readAutostart(launchctlOf(ctx), f, ctx.uid, await bootTime(ctx));
}

/**
 * `hub up` without `--foreground`: a server launchd runs is opened, not started twice; a loaded agent that is not running (stopped,
 * or stopped by the guard) is kickstarted and waited for. Null: autostart is off or not set up here, so the caller runs the
 * server in the foreground as before.
 */
export async function upViaLaunchd(ctx: Ctx, deps: CommandDeps): Promise<number | null> {
  const s = await stateOf(ctx, deps);
  if (!s || !s.enabled || !s.loaded) return null;
  const out = deps.out ?? ((l: string) => console.log(l));
  const ports = instancePorts(ctx.paths);
  const url = adminUrl(ports.admin);
  const f = filesOf(ctx);
  if (s.running) {
    out(`${c.green("already running")} (started at login by launchd, label ${s.label}) ${c.dim("→")} ${c.cyan(url)}`);
    await deps.open?.(url);
    return 0;
  }
  // A hand-run holds the ports (the agent stood by): the foreground path says "port in use", as before.
  if ((await deps.portBusy(ports.api)) || (await deps.portBusy(ports.admin))) return null;
  // A guard tripped before a fix: the owner asks again, so the guard starts over.
  appendStart(f.starts, { at: new Date((deps.now ?? Date.now)()).toISOString(), event: "reset", detail: "hub up" });
  await kickstart(ctx, s.label);
  out(c.dim(`started by launchd (${s.label}); waiting for the server (a start after a code change builds first, about a minute)...`));
  if (!(await wait(deps, () => deps.healthy(ports.api), 180_000))) {
    out(c.red(`the server did not answer within 3 minutes: read ${f.log}`));
    return 1;
  }
  out(`${c.green("Admin + API (live data)")} ${c.dim("→")} ${c.cyan(url)} ${c.dim(`(launchd, ${s.label}; log ${f.log}; \`hub stop\` stops it)`)}`);
  await deps.open?.(url);
  return 0;
}

/** `hub stop`: SIGTERM to the launchd job (it exits 0: not respawned). A hand-run is the owner's terminal's to stop. */
export async function stopCommand(ctx: Ctx, deps: CommandDeps): Promise<number> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const ports = instancePorts(ctx.paths);
  const s = await stateOf(ctx, deps);
  if (s?.running) {
    await killJob(ctx, s.label);
    const gone = await wait(deps, async () => !(await printJob(ctx, s.label)).running, 35_000);
    out(gone ? `stopped (${s.label}); it starts again at the next login${s.enabled ? "" : " only if autostart is switched on"}, or now with \`./run.sh up\`` : c.red(`${s.label} did not stop within 35 s: read ${filesOf(ctx).log}`));
    return gone ? 0 : 1;
  }
  if ((await deps.portBusy(ports.api)) || (await deps.portBusy(ports.admin))) {
    out(`the server was started by hand (not by launchd): press Ctrl-C in its terminal`);
    return 1;
  }
  out("not running");
  return 0;
}

/** `hub restart`: `launchctl kickstart -k` (the guard starts over), then waits for the server. */
export async function restartCommand(ctx: Ctx, deps: CommandDeps): Promise<number> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const s = await stateOf(ctx, deps);
  if (!s) {
    out(`autostart is not set up here (${(deps.platform ?? process.platform) === "darwin" ? AUTOSTART_FIX : "macOS only"}): stop the server with Ctrl-C and start it with ./run.sh up`);
    return 1;
  }
  if (!s.enabled) {
    out("autostart is switched off: `hub autostart on` first, or stop the hand-run with Ctrl-C and start it with ./run.sh up --foreground");
    return 1;
  }
  const f = filesOf(ctx);
  appendStart(f.starts, { at: new Date((deps.now ?? Date.now)()).toISOString(), event: "reset", detail: "hub restart" });
  await kickstart(ctx, s.label, true);
  const port = instancePorts(ctx.paths).api;
  // `-k` stops the old one first: give it a moment so the old server's answer is not taken for the new one's.
  await (deps.sleep ?? sleepMs)(2000);
  const ok = await wait(deps, () => deps.healthy(port), 180_000);
  out(ok ? `restarted (${s.label}) → ${adminUrl(instancePorts(ctx.paths).admin)}` : c.red(`restarted, but the server did not answer within 3 minutes: read ${f.log}`));
  return ok ? 0 : 1;
}

/** The one status line (the admin's row says the same in its words). */
export function statusLine(s: AutostartState | null, startedByLaunchd: boolean | null): string {
  if (!s) return `Not set up: ${AUTOSTART_FIX}`;
  if (s.guard) return `Stopped after 5 failed starts at ${s.guard.at}: ${s.guard.error}. Fix, then ./run.sh restart`;
  if (!s.enabled) return "Off: a running server keeps running until you stop it; it will not start after the next restart";
  if (!s.loaded) return `On, but not loaded: ${AUTOSTART_FIX}`;
  if (s.running) return `On: started by launchd${s.lastStart ? ` at ${s.lastStart.at}` : ""}`;
  return startedByLaunchd === false ? "On: this server was started by hand; launchd takes over at the next restart" : "On: not running now (`./run.sh up` starts it through launchd)";
}

/** `hub autostart [status|on|off]`. */
export async function autostartCommand(ctx: Ctx, action: string | undefined, deps: CommandDeps): Promise<number> {
  const out = deps.out ?? ((l: string) => console.log(l));
  if ((deps.platform ?? process.platform) !== "darwin") {
    out("macOS only: nothing starts the Hub at login on this system");
    return 2;
  }
  const f = filesOf(ctx);
  if (action === undefined || action === "status") {
    const s = await stateOf(ctx, deps);
    const handRun = !!s && !s.running && (await deps.portBusy(instancePorts(ctx.paths).api));
    out(statusLine(s, s ? !handRun : null));
    return 0;
  }
  if (action !== "on" && action !== "off") {
    out("usage: hub autostart [status|on|off]");
    return 2;
  }
  try {
    await switchAutostart(launchctlOf(ctx), f, ctx.uid, action === "on");
  } catch (e) {
    out(c.red(e instanceof AutostartRefusal ? `Not set up: ${AUTOSTART_FIX}` : e instanceof Error ? e.message : String(e)));
    return 1;
  }
  out(action === "off" ? "Off: a running server keeps running until you stop it (`hub stop`); it will not start after the next restart" : "On: the Hub starts after every restart (a server running now keeps running)");
  return 0;
}
