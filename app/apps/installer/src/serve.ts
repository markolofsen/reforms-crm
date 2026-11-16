import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { hubPaths, instancePorts } from "@hub/config/paths";
import { c, UsageError } from "./term.ts";

const pnpm = (args: string[], cwd: string): ChildProcess => spawn("pnpm", args, { cwd, stdio: "inherit" });
const exited = (p: ChildProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    p.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ENOENT" ? new UsageError("`pnpm` is not on PATH. Run ./install.sh once.") : e));
    p.on("exit", (code, signal) => resolve(code ?? (signal ? 130 : 1)));
  });

export const adminUrl = (port: number): string => `http://127.0.0.1:${port}`;

/** True when something already listens on 127.0.0.1:`port`. */
export const portBusy = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(true));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(false)));
  });

/** Open the browser once the admin answers (up to 3 minutes: a start after a code change builds first). Best effort: a failure never stops the server. */
async function openWhenUp(url: string): Promise<void> {
  for (let i = 0; i < 180; i++) {
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" }).on("error", () => {}).unref();
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
export async function runUp(core: string, opts: { open?: boolean; demo?: boolean } = {}): Promise<number> {
  const app = path.join(core, "app");
  const demoHome = opts.demo ? makeDemoHome() : undefined;
  // The demo instance is its own HUB_HOME: HUB_PROJECTS, HUB_DB and friends are cleared so nothing reaches the live instance.
  const env = demoHome
    ? { ...process.env, HUB_HOME: demoHome, HUB_PROJECTS: "", HUB_DB: "", HUB_CONFIG_DIR: "", HUB_CONFIG_FILE: "" }
    : process.env;
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
    if (opts.open ?? true) void openWhenUp(url);
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
