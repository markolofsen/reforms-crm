import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { AUTOSTART_FIX, autostartFiles, launchAgentsDir, parseBootTime, readAutostart, switchAutostart, type LaunchctlRun } from "@hub/config/autostart";
import type { HubPaths } from "@hub/config/paths";
import type { RuntimeModes } from "@hub/config/modes";
import { autostartDto, type AutostartDto } from "@hub/contract/autostart";

// P67 (decision 0033): the server's side of "Start the Hub after a restart". It reads the LaunchAgent's state and switches it
// with exactly `launchctl enable|disable gui/<uid>/<label>` (plus `bootstrap` of the installed plist on On when not loaded). It
// never writes or removes a plist and never runs `bootout`, `kill` or `kickstart`: Off keeps this very server running.

export type LaunchctlKind = RuntimeModes["launchctl"];

const LAUNCHCTL = "/bin/launchctl";

const realLaunchctl: LaunchctlRun = (args) =>
  new Promise((resolve) => {
    execFile(LAUNCHCTL, args, { timeout: 10_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/**
 * The fake launchd (`HUB_LAUNCHCTL=fake`): every argv is one JSON line in `state/autostart/launchctl.jsonl`; the job is loaded
 * and not running, and `enable`/`disable` are remembered in memory. Nothing reaches launchd.
 */
export function fakeLaunchctl(log: string, label: string): LaunchctlRun {
  let disabled = false;
  let loaded = true;
  return async (args) => {
    mkdirSync(join(log, ".."), { recursive: true });
    appendFileSync(log, `${JSON.stringify({ argv: ["launchctl", ...args] })}\n`);
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    switch (args[0]) {
      case "print":
        return loaded ? ok("\tstate = not running\n") : { code: 113, stdout: "", stderr: "Could not find service" };
      case "print-disabled":
        return ok(`disabled services = {\n\t\t"${label}" => ${disabled ? "disabled" : "enabled"}\n}\n`);
      case "disable":
        disabled = true;
        return ok();
      case "enable":
        disabled = false;
        return ok();
      case "bootstrap":
        loaded = true;
        return ok();
      default:
        return { code: 1, stdout: "", stderr: `the fake refuses ${args[0]}` };
    }
  };
}

/**
 * The launchctl for a kind read once at start (`@hub/config/modes`, `HUB_LAUNCHCTL`): `launchctl` is `/bin/launchctl` on the
 * user's `~/Library/LaunchAgents`; `fake` is the recorder above on a LaunchAgents folder inside the instance
 * (`state/autostart/LaunchAgents`). The throwaway-database rule is the reader's.
 */
export function launchctlFor(kind: LaunchctlKind, env: { HOME?: string | undefined }, paths: Pick<HubPaths, "home" | "autostart">): { kind: LaunchctlKind; run: LaunchctlRun; agentsDir: string } {
  if (kind === "launchctl") return { kind, run: realLaunchctl, agentsDir: launchAgentsDir(env.HOME || homedir()) };
  const agentsDir = join(paths.autostart, "LaunchAgents");
  return { kind, run: fakeLaunchctl(join(paths.autostart, "launchctl.jsonl"), autostartFiles(paths, agentsDir).label), agentsDir };
}

/** mail-mcp answers on localhost:8787 (a TCP connect, 1 s): the agent session's Mail, which an autostarted Hub must not hide. */
export const mailMcpUp = (port = 8787): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createConnection({ host: "localhost", port, timeout: 1000 });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    s.once("timeout", () => done(false));
  });

const sysctlBoot = (): Promise<number | undefined> =>
  new Promise((resolve) => execFile("/usr/sbin/sysctl", ["-n", "kern.boottime"], { timeout: 2000 }, (err, out) => resolve(err ? undefined : parseBootTime(String(out)))));

export interface AutostartOptions {
  paths: Pick<HubPaths, "home" | "autostart">;
  run: LaunchctlRun;
  agentsDir: string;
  uid: number;
  /** `launchd` when this server runs under the agent (`HUB_AUTOSTART=1`). */
  startedBy: "launchd" | "hand";
  supported: boolean;
  bootAt?: () => Promise<number | undefined>;
  mailMcp?: () => Promise<boolean>;
}

export class AutostartNotSetUp extends Error {}

export interface AutostartService {
  read(): Promise<AutostartDto>;
  set(enabled: boolean): Promise<AutostartDto>;
  /**
   * For the live topic `autostart`: moves on every switch, a new line in `starts.jsonl` and the off file coming or going. Not
   * the log (it grows with every server line) and not the fake's argv file (a read writes it).
   */
  signature(): string;
}

export function createAutostart(o: AutostartOptions): AutostartService {
  const files = autostartFiles(o.paths, o.agentsDir);
  let version = 0;
  const read = async (): Promise<AutostartDto> => {
    if (!o.supported) return autostartDto.parse({ supported: false, label: files.label, installed: false, enabled: false, loaded: false, running: false, startedBy: o.startedBy, lastStart: null, guard: null, mailMcp: null, fix: null });
    const s = await readAutostart(o.run, files, o.uid, await (o.bootAt ?? sysctlBoot)());
    // `lastStartOf` returns only a start, a stand-by or the off file.
    const last = s.lastStart ? { at: s.lastStart.at, event: s.lastStart.event as "start" | "standby" | "off" } : null;
    return autostartDto.parse({
      supported: true,
      label: s.label,
      installed: s.installed,
      enabled: s.installed && s.enabled,
      loaded: s.loaded,
      running: s.running,
      startedBy: o.startedBy,
      lastStart: last,
      guard: s.guard,
      mailMcp: s.installed && s.enabled ? await (o.mailMcp ?? mailMcpUp)() : null,
      fix: s.installed && s.loaded ? null : AUTOSTART_FIX,
    });
  };
  return {
    read,
    async set(enabled) {
      if (!o.supported) throw new AutostartNotSetUp("Starting the Hub after a restart needs macOS.");
      const before = await read();
      if (!before.installed) throw new AutostartNotSetUp(`Not set up: run \`${AUTOSTART_FIX}\` in the instance folder.`);
      await switchAutostart(o.run, files, o.uid, enabled);
      version++;
      return read();
    },
    signature: () => {
      let starts = "none";
      try {
        const st = statSync(files.starts);
        starts = `${st.size}:${st.mtimeMs}`;
      } catch {
        /* no start yet */
      }
      return `${version}|${starts}|${existsSync(files.off) ? "off" : "on"}`;
    },
  };
}
