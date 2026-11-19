import { dirname, join } from "node:path";
import { autostartFiles, launchAgentsDir, type AutostartFiles } from "@hub/config/autostart";
import type { Ctx } from "./context";

// P67 (decision 0033): the LaunchAgent of one instance. The plist is built by one pure function and written only by the
// installer step `autostart.agent`; the server only reads and switches it.

export interface PlistOptions {
  label: string;
  /** The instance root (`HUB_HOME`): `run.sh` lives there and it is the working directory. */
  home: string;
  /** The folder holding the `node` (and `pnpm`) the installer runs on: first on the job's `PATH` (launchd gives `/usr/bin:/bin:/usr/sbin:/sbin`). */
  nodeDir: string;
  log: string;
}

/** The rest of the job's PATH after the node folder. */
export const PATH_TAIL = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const str = (s: string) => `<string>${xml(s)}</string>`;

/**
 * The plist (section 4 of P67): `/bin/bash <home>/run.sh up --service` in the instance, `HUB_AUTOSTART=1`, the node folder first on
 * PATH, `LANG` (launchd sets none), no turbo daemon left behind; restarted on a crash (`SuccessfulExit: false`, 30 s throttle), never
 * after a clean exit; in the owner's GUI session only. `SHELL` is not set: launchd already gives the login shell (S0).
 */
export function autostartPlist(o: PlistOptions): string {
  const env: [string, string][] = [["HUB_AUTOSTART", "1"], ["PATH", `${o.nodeDir}:${PATH_TAIL}`], ["LANG", "en_US.UTF-8"], ["TURBO_DAEMON", "false"]];
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>${str(o.label)}`,
    `  <key>ProgramArguments</key>`,
    `  <array>${["/bin/bash", join(o.home, "run.sh"), "up", "--service"].map(str).join("")}</array>`,
    `  <key>WorkingDirectory</key>${str(o.home)}`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    ...env.map(([k, v]) => `    <key>${k}</key>${str(v)}`),
    `  </dict>`,
    `  <key>RunAtLoad</key><true/>`,
    `  <key>KeepAlive</key>`,
    `  <dict>`,
    `    <key>SuccessfulExit</key><false/>`,
    `  </dict>`,
    `  <key>ThrottleInterval</key><integer>30</integer>`,
    `  <key>ExitTimeOut</key><integer>30</integer>`,
    `  <key>ProcessType</key><string>Interactive</string>`,
    `  <key>LimitLoadToSessionType</key><string>Aqua</string>`,
    `  <key>StandardOutPath</key>${str(o.log)}`,
    `  <key>StandardErrorPath</key>${str(o.log)}`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

const unxml = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** What the doctor needs back from a plist this installer wrote (any other shape is reported as not parsed). */
export interface PlistFacts {
  label: string;
  home: string;
  program: string[];
  nodeDir: string;
}

export function readPlist(text: string): PlistFacts | undefined {
  const after = (key: string) => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(text)?.[1];
  const label = after("Label");
  const home = after("WorkingDirectory");
  const pathVar = after("PATH");
  const arr = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1];
  if (!label || !home || !pathVar || arr === undefined || !text.includes("<plist")) return undefined;
  const program = [...arr.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unxml(m[1] ?? ""));
  return { label: unxml(label), home: unxml(home), program, nodeDir: unxml(pathVar).split(":")[0] ?? "" };
}

/** The node folder of this run: `dirname(process.execPath)` (here nvm's, which also holds `pnpm`). */
export const currentNodeDir = (): string => dirname(process.execPath);

/** This instance's agent files: label, plist under the user's `~/Library/LaunchAgents`, `state/autostart/`. */
export const filesOf = (ctx: Ctx): AutostartFiles => autostartFiles(ctx.paths, launchAgentsDir(ctx.home));

export { launchAgentsDir };
