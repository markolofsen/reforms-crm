import { launchctlArgv, parseDisabled, parsePrint, type JobState, type LaunchctlRun } from "@hub/config/autostart";
import type { Ctx } from "./context";

// Every launchctl call of the installer, one argv each (`@hub/config/autostart` owns the argv), through `ctx.run`: tests fake it.

const LAUNCHCTL = "launchctl";

/** `ctx.run` as the runner `@hub/config/autostart` takes. */
export const launchctlOf = (ctx: Ctx): LaunchctlRun => (args) => ctx.run(LAUNCHCTL, args);

/** Is a launchd label loaded for this user? (`mail.daemon` asks it of mail-mcp's brew service; the autostart step of its own agent.) */
export async function isLoaded(ctx: Ctx, label: string): Promise<boolean> {
  return (await ctx.run(LAUNCHCTL, launchctlArgv.print(ctx.uid, label))).code === 0;
}

/** Loaded, running, pid. */
export async function printJob(ctx: Ctx, label: string): Promise<JobState> {
  const r = await ctx.run(LAUNCHCTL, launchctlArgv.print(ctx.uid, label));
  return parsePrint(r.code, r.stdout);
}

/** Switched off in launchd's disabled database (`launchctl disable`). */
export async function isDisabled(ctx: Ctx, label: string): Promise<boolean> {
  return parseDisabled((await ctx.run(LAUNCHCTL, launchctlArgv.printDisabled(ctx.uid))).stdout, label);
}

const must = async (ctx: Ctx, args: string[]): Promise<void> => {
  const r = await ctx.run(LAUNCHCTL, args);
  if (r.code !== 0) throw new Error(`launchctl ${args.join(" ")} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().split("\n")[0] ?? ""}`);
};

export const bootstrap = (ctx: Ctx, plist: string) => must(ctx, launchctlArgv.bootstrap(ctx.uid, plist));
export const bootout = (ctx: Ctx, label: string) => must(ctx, launchctlArgv.bootout(ctx.uid, label));
export const enable = (ctx: Ctx, label: string) => must(ctx, launchctlArgv.enable(ctx.uid, label));
export const disable = (ctx: Ctx, label: string) => must(ctx, launchctlArgv.disable(ctx.uid, label));
/** `kickstart` starts a loaded job that is not running; `restart` (`-k`) kills a running one first. */
export const kickstart = (ctx: Ctx, label: string, restart = false) => must(ctx, launchctlArgv.kickstart(ctx.uid, label, restart));
/** SIGTERM to the job's process: `hub up --service` forwards it to the server's process group and exits 0 (not respawned). */
export const killJob = (ctx: Ctx, label: string) => must(ctx, launchctlArgv.kill(ctx.uid, label, "SIGTERM"));
