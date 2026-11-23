import { readInstanceConfig } from "@hub/config/instance";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ADMIN_PORT, SERVER_PORT } from "@hub/config";
import { AUTOSTART_FIX, guardOf, LABEL_PREFIX, LOG_WARN_BYTES, logBytes, parseBootTime, readStarts, lastStartOf } from "@hub/config/autostart";
import { hubPaths, instancePorts } from "@hub/config/paths";
import { autostartPlist, currentNodeDir, filesOf, launchAgentsDir, readPlist } from "../autostart";
import type { Ctx } from "../context";
import { bootout, bootstrap, isDisabled, printJob } from "../launchctl";
import type { CheckResult, Step } from "../types";
import { fail, pass, warn } from "./helpers";
import { portBusy } from "../net";

const SYSCTL = "/usr/sbin/sysctl";
/** Folders launchd cannot run a job from without the owner granting it (simple-crm on ~/Desktop: exit 126). */
const PROTECTED = ["Desktop", "Documents", "Downloads"];

export async function bootTime(ctx: Ctx): Promise<number | undefined> {
  return parseBootTime((await ctx.run(SYSCTL, ["-n", "kern.boottime"])).stdout);
}

/** The instance's ports as written in its config: autostart needs them explicit (`instancePorts` would fill in the defaults). */
function explicitPorts(ctx: Ctx): { admin?: number; api?: number } {
  const cfg = readInstanceConfig(ctx.paths).config;
  const n = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : undefined);
  return { admin: n(cfg.admin_port), api: n(cfg.api_port) };
}

/** Another Hub agent in the same LaunchAgents folder that names this instance, or one on the same ports. */
function clash(ctx: Ctx, label: string, ports: { admin: number; api: number }): string | undefined {
  const dir = launchAgentsDir(ctx.home);
  let names: string[] = [];
  try { names = readdirSync(dir).filter((n) => n.startsWith(LABEL_PREFIX) && n.endsWith(".plist") && n !== `${label}.plist`); } catch { return undefined; }
  for (const n of names) {
    let facts;
    try { facts = readPlist(readFileSync(path.join(dir, n), "utf8")); } catch { continue; }
    if (!facts) continue;
    if (path.resolve(facts.home) === path.resolve(ctx.paths.home)) return `${n} also starts this instance: remove one (\`launchctl bootout gui/${ctx.uid}/${facts.label}\`, then delete the file)`;
    try {
      const other = instancePorts(hubPaths({ home: facts.home, env: {} }), {});
      if (other.admin === ports.admin || other.api === ports.api) return `${n} starts ${facts.home} on the same port (${other.admin}/${other.api}): give one instance other ports in its config/config.json`;
    } catch { /* its instance is gone: that agent's own doctor says so */ }
  }
  return undefined;
}

/** The checks of verdict 10, in order; the first failure wins. Read only. */
export async function autostartCheck(ctx: Ctx, platform: NodeJS.Platform = process.platform): Promise<CheckResult> {
  if (platform !== "darwin") return pass("macOS only: nothing to start at login here");
  const f = filesOf(ctx);
  if (!existsSync(f.plist)) {
    // On by default, but only on explicit ports: a fresh instance on the default pair is told what to set first (not a failure of it).
    const ex = explicitPorts(ctx);
    if (ex.admin === undefined || ex.api === undefined || ex.admin === ADMIN_PORT || ex.api === SERVER_PORT) return warn(`not set up: set admin_port and api_port (not ${ADMIN_PORT}/${SERVER_PORT}) in ${ctx.paths.configFile}, then ${AUTOSTART_FIX}`);
    return fail(`not set up: no ${f.plist} (${AUTOSTART_FIX})`);
  }
  const facts = readPlist(readFileSync(f.plist, "utf8"));
  if (!facts) return fail(`${f.plist} does not parse as the Hub's agent: ${AUTOSTART_FIX} rewrites it`);
  if (facts.label !== f.label) return fail(`the plist's label is ${facts.label}, not ${f.label}: ${AUTOSTART_FIX} rewrites it`);
  if (path.resolve(facts.home) !== path.resolve(ctx.paths.home)) return fail(`the plist starts ${facts.home}, not this instance (moved?): ${AUTOSTART_FIX} rewrites it`);
  const rel = path.relative(ctx.home, ctx.paths.home).split(path.sep)[0];
  if (rel && PROTECTED.includes(rel)) return fail(`the instance is under ~/${rel}: launchd cannot start a job there (exit 126); move the instance out of ~/${rel}`);
  for (const bin of ["node", "pnpm"]) if (!existsSync(path.join(facts.nodeDir, bin))) return fail(`no ${bin} in ${facts.nodeDir} (the plist's node folder; an nvm upgrade?): ${AUTOSTART_FIX} rewrites it with this node`);
  const ex = explicitPorts(ctx);
  if (ex.admin === undefined || ex.api === undefined) return fail(`set admin_port and api_port in ${ctx.paths.configFile}: an instance started at login must not take the default pair ${ADMIN_PORT}/${SERVER_PORT} (hub up --demo and pnpm live use it)`);
  if (ex.admin === ADMIN_PORT || ex.api === SERVER_PORT) return fail(`admin_port ${ex.admin} / api_port ${ex.api}: an instance started at login must not use the default ${ADMIN_PORT}/${SERVER_PORT} (hub up --demo and pnpm live use them); pick others in ${ctx.paths.configFile}`);
  const other = clash(ctx, f.label, instancePorts(ctx.paths, {}));
  if (other) return fail(other);
  if ((await isDisabled(ctx, f.label)) || existsSync(f.off)) return warn("off (switched off in the admin or `hub autostart off`): this instance will not start after a restart");
  const job = await printJob(ctx, f.label);
  if (!job.loaded) return fail(`the agent ${f.label} is not loaded in gui/${ctx.uid}: ${AUTOSTART_FIX} loads it`);
  const lines = readStarts(f.starts);
  const boot = await bootTime(ctx);
  const g = guardOf(lines, boot);
  if (g) return fail(`stopped after 5 failed starts at ${g.at}: ${g.error}. Fix it, then \`./run.sh restart\``);
  const last = lastStartOf(lines);
  if (boot !== undefined && (!last || Date.parse(last.at) < boot)) return warn("on, but did not start after the last restart: System Settings > General > Login Items > Allow in the Background may have it off");
  const bytes = logBytes(f.log);
  if (bytes > LOG_WARN_BYTES) return warn(`${f.log} is ${Math.round(bytes / 1048576)} MB (rotated at 5 MB on each start): a start loop? Read its end`);
  return pass(`on (${f.label}): ${job.running ? `running, pid ${job.pid ?? "?"}` : "loaded, not running now (a hand-run holds the ports, or `hub stop`)"}`);
}

/**
 * Writes the plist (0644) and `state/autostart/`, then loads it. A loaded agent that runs is not touched (that would stop the
 * server): the new file applies at the next login. With the ports held by a hand-run the agent stands by (exit 0) and takes over
 * at the next restart. What it cannot fix (protected folder, default ports) it refuses with the reason.
 */
export async function autostartApply(ctx: Ctx): Promise<string> {
  const f = filesOf(ctx);
  const rel = path.relative(ctx.home, ctx.paths.home).split(path.sep)[0];
  if (rel && PROTECTED.includes(rel)) throw new Error(`the instance is under ~/${rel}: launchd cannot start a job there; move it first`);
  const ex = explicitPorts(ctx);
  if (ex.admin === undefined || ex.api === undefined || ex.admin === ADMIN_PORT || ex.api === SERVER_PORT) throw new Error(`set admin_port and api_port (not ${ADMIN_PORT}/${SERVER_PORT}) in ${ctx.paths.configFile} first; the installer never edits the instance's config`);
  mkdirSync(f.dir, { recursive: true });
  mkdirSync(path.dirname(f.plist), { recursive: true });
  writeFileSync(f.plist, autostartPlist({ label: f.label, home: ctx.paths.home, nodeDir: currentNodeDir(), log: f.log }));
  chmodSync(f.plist, 0o644);
  const job = await printJob(ctx, f.label);
  if (job.running) return `wrote ${f.plist}; the agent runs the server now, the new file applies at the next login`;
  if (job.loaded) await bootout(ctx, f.label);
  await bootstrap(ctx, f.plist);
  const held = await portBusy(instancePorts(ctx.paths, {}).api);
  return held ? `wrote and loaded ${f.plist}; a server started by hand holds the ports, so launchd takes over at the next restart` : `wrote and loaded ${f.plist}: the server starts now and after every restart`;
}

export const autostartSteps: Step[] = [
  {
    id: "autostart.agent", group: "Server", title: "The Hub starts after a restart",
    why: "After the Mac restarts, the admin and the API should be there without opening a terminal (decision 0033). One LaunchAgent per instance starts `./run.sh up --service` at login; no agent session starts until the dock is opened.",
    verifies: "macOS only. The instance's plist in ~/Library/LaunchAgents parses, names this instance and a node folder that still has node and pnpm, the instance is not under ~/Desktop, ~/Documents or ~/Downloads, its ports are explicit and not the default pair, no other Hub agent names it or its ports; then: switched off is a WARN; loaded in the login session; not stopped by the start guard (5 failed starts in 15 minutes); it ran since the last boot (else a WARN naming Login Items > Allow in the Background); its log is under 10 MB.",
    does: "write ~/Library/LaunchAgents/com.reforms.hub.<instance>.plist and state/autostart/, then launchctl bootstrap it (a running agent is left running). It needs admin_port and api_port set in config/config.json (not 5173/4317) first; if macOS shows \"Background Items Added\", leave it allowed (Login Items > Allow in the Background)",
    check: (ctx) => autostartCheck(ctx),
    apply: autostartApply,
  },
];
