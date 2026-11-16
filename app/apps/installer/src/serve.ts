import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { ADMIN_PORT } from "@hub/config";
import { hubPaths } from "@hub/config/paths";
import { c, UsageError } from "./term.ts";

const pnpm = (args: string[], cwd: string): ChildProcess => spawn("pnpm", args, { cwd, stdio: "inherit" });
const exited = (p: ChildProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    p.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ENOENT" ? new UsageError("`pnpm` is not on PATH. Run ./install.sh once.") : e));
    p.on("exit", (code, signal) => resolve(code ?? (signal ? 130 : 1)));
  });

export const adminUrl = (env: NodeJS.ProcessEnv = process.env): string => `http://127.0.0.1:${env.HUB_ADMIN_PORT || ADMIN_PORT}`;

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

/**
 * Admin + API from a production build of the admin (`next build` is replayed from the turbo cache when no source changed,
 * then `next start`), 127.0.0.1 only, opens the browser. The hot-reload loop is `pnpm live`, not this. Two databases, never mixed:
 * live = the instance database (`app/data/app.db` in the single-repo layout), demo = `demo.db` beside it (invented clients, seeded here before start).
 */
export async function runUp(root: string, opts: { open?: boolean; demo?: boolean } = {}): Promise<number> {
  const app = path.join(root, "app");
  const url = adminUrl();
  // The demo database sits beside the live one (same data folder), never inside it; HUB_DB is deliberately ignored for its location.
  const env = opts.demo ? { ...process.env, HUB_DB: path.join(path.dirname(hubPaths({ core: root, env: { ...process.env, HUB_DB: "" } }).db), "demo.db") } : process.env;
  if (opts.demo) {
    const seeded = await exited(spawn("pnpm", ["db:seed"], { cwd: app, stdio: "inherit", env }));
    if (seeded !== 0) { console.error(c.red(`seeding the demo database failed (exit ${seeded})`)); return seeded; }
  }
  console.log(c.dim("The admin is built first when its code changed since the last start (about a minute); an unchanged one starts in seconds."));
  console.log(`${opts.demo ? c.yellow("Admin + API (DEMO data, invented clients)") : c.green("Admin + API (live data)")} ${c.dim("→")} ${c.cyan(url)} ${c.dim("(Ctrl-C stops)")}`);
  if (opts.open ?? true) void openWhenUp(url);
  return holdSignals(() => exited(spawn("pnpm", ["start"], { cwd: app, stdio: "inherit", env })));
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
