import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hubPaths, instancePorts } from "@hub/config/paths";
import { execFileOpen, localOpenAvailable, openTarget } from "@hub/projects/local-open";
import { c, UsageError } from "./term";

const pnpm = (args: string[], cwd: string): ChildProcess => spawn("pnpm", args, { cwd, stdio: "inherit" });
const exited = (p: ChildProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    p.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ENOENT" ? new UsageError("`pnpm` is not on PATH. Run ./install.sh once.") : e));
    p.on("exit", (code, signal) => resolve(code ?? (signal ? 130 : 1)));
  });

import { adminUrl, healthy, portBusy } from "./net";
import { filesOf } from "./autostart";
import { upViaLaunchd } from "./autostart-command";
import type { Ctx } from "./context";
import { defaultServiceDeps, runService, type ServiceDeps } from "./service";

export { adminUrl, portBusy };

/**
 * Open the browser once the admin answers (up to 3 minutes: a start after a code change builds first), through the one opener
 * (P61: `/usr/bin/open`, the admin's own URL on the allowlist). Off macOS the URL printed above is the way in. Best effort:
 * a failure never stops the server.
 */
async function openWhenUp(url: string, adminPort: number): Promise<void> {
  if (!localOpenAvailable()) return;
  for (let i = 0; i < 180; i++) {
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  await openTarget({ kind: "url", url, label: "the admin" }, execFileOpen, { adminPort }).catch(() => {});
}

/** Run until the user presses Ctrl-C: signals reach the children through the terminal, we only wait. */
async function holdSignals<T>(work: () => Promise<T>): Promise<T> {
  const ignore = () => {};
  process.on("SIGINT", ignore); process.on("SIGTERM", ignore);
  try { return await work(); } finally { process.off("SIGINT", ignore); process.off("SIGTERM", ignore); }
}

/** A throw-away instance folder under the OS temp dir for `hub up --demo`: the layout of any instance, never inside the core. */
export function makeDemoHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "hub-demo-"));
  for (const d of ["projects", "data", "state", "config"]) mkdirSync(path.join(home, d));
  return home;
}

/**
 * Admin + API from a production build of the admin (`next build` is replayed from the turbo cache when no source changed,
 * then `next start`), 127.0.0.1 only, opens the browser. The hot-reload loop is `pnpm live`, not this. Two instances, never mixed:
 * live = the instance named by `HUB_HOME`, demo = a throw-away instance folder in the OS temp dir (invented clients, seeded there, removed on exit).
 */
export interface UpOptions {
  open?: boolean;
  demo?: boolean;
  /** P67: what the LaunchAgent runs (`HUB_AUTOSTART=1`): never opens the browser, never loops launchd (`service.ts`). */
  service?: boolean;
  /** P67: the old run in this terminal whatever launchd holds (it still refuses taken ports). */
  foreground?: boolean;
  /** The live instance's context, for the launchd checks (absent with `--demo`). */
  ctx?: Ctx;
  /** Tests: the service's process seams. */
  serviceDeps?: Partial<ServiceDeps>;
}

export async function runUp(core: string, opts: UpOptions = {}): Promise<number> {
  const app = path.join(core, "app");
  if (opts.service) {
    if (!opts.ctx || opts.demo) throw new UsageError("--service runs a live instance (the LaunchAgent's): not with --demo");
    const paths = opts.ctx.paths;
    return runService({ files: filesOf(opts.ctx), ports: instancePorts(paths), env: { ...process.env, HUB_HOME: paths.home } }, { ...defaultServiceDeps(app, portBusy), ...opts.serviceDeps });
  }
  if (opts.ctx && !opts.demo && !opts.foreground) {
    const ports = instancePorts(opts.ctx.paths);
    const viaLaunchd = await upViaLaunchd(opts.ctx, { healthy, portBusy, ...((opts.open ?? true) ? { open: (url: string) => openWhenUp(url, ports.admin) } : {}) });
    if (viaLaunchd !== null) return viaLaunchd;
  }
  const demoHome = opts.demo ? makeDemoHome() : undefined;
  // The demo instance is its own HUB_HOME: HUB_PROJECTS, HUB_DB and friends are cleared so nothing reaches the live instance.
  // A hand-run is never "started by launchd": HUB_AUTOSTART is the service's alone.
  const { HUB_AUTOSTART: _service, ...own } = process.env;
  const env = demoHome
    ? { ...own, HUB_HOME: demoHome, HUB_PROJECTS: "", HUB_DB: "", HUB_CONFIG_DIR: "", HUB_CONFIG_FILE: "" }
    : own;
  // Live: the ports of THIS instance (config.json admin_port/api_port), so two instances run side by side. Demo: the defaults.
  const paths = hubPaths({ env });
  const ports = instancePorts(paths, demoHome ? {} : env);
  const url = adminUrl(ports.admin);
  const run = { ...env, HUB_HOME: paths.home, HUB_ADMIN_PORT: String(ports.admin), HUB_PORT: String(ports.api) };
  try {
    for (const [name, port] of [["admin", ports.admin], ["API", ports.api]] as const) {
      if (await portBusy(port)) {
        console.error(c.red(`port ${port} (the ${name}) is already in use: another hub is running? Stop it, or set a different ${name === "API" ? "api_port" : "admin_port"} in config/config.json`));
        return 1;
      }
    }
    if (demoHome) {
      const seeded = await exited(spawn("pnpm", ["db:seed"], { cwd: app, stdio: "inherit", env: run }));
      if (seeded !== 0) { console.error(c.red(`seeding the demo database failed (exit ${seeded})`)); return seeded; }
    }
    console.log(c.dim("The admin is built first when its code changed since the last start (about a minute); an unchanged one starts in seconds."));
    console.log(`${demoHome ? c.yellow("Admin + API (DEMO data, invented clients)") : c.green("Admin + API (live data)")} ${c.dim("→")} ${c.cyan(url)} ${c.dim("(Ctrl-C stops)")}`);
    if (opts.open ?? true) void openWhenUp(url, ports.admin);
    return await holdSignals(() => exited(spawn("pnpm", ["start"], { cwd: app, stdio: "inherit", env: run })));
  } finally {
    if (demoHome) rmSync(demoHome, { recursive: true, force: true });
  }
}

/** typecheck, then tests, for the whole monorepo. */
export async function runTests(root: string): Promise<number> {
  const app = path.join(root, "app");
  for (const step of ["typecheck", "test"]) {
    console.log(c.bold(`pnpm ${step}`));
    const code = await exited(pnpm([step], app));
    if (code !== 0) { console.error(c.red(`${step} failed (exit ${code})`)); return code; }
  }
  console.log(c.green("typecheck and tests passed"));
  return 0;
}
