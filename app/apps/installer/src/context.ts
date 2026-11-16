import { execa } from "execa";
import { homedir } from "node:os";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CORE_ROOT, hubPaths, type HubPaths } from "@hub/config/paths";

export interface RunResult { code: number; stdout: string; stderr: string }
export type Runner = (cmd: string, args: string[], opts?: { env?: Record<string, string>; timeoutMs?: number; input?: string }) => Promise<RunResult>;

export interface Ctx {
  /** The instance root (`HUB_HOME`): where state, config, secrets and projects live. */
  root: string;
  /** Every path the installer uses, resolved once by `@hub/config/paths`. Code and skills come from `paths.core`. */
  paths: HubPaths;
  home: string;
  uid: number;
  dryRun: boolean;
  /** Directory for secrets: `<root>/state/secrets` (git-ignored, mode 700); `HUB_CONFIG_DIR` overrides (same as `paths.secrets`). */
  configDir: string;
  /** PATH used to find tools; tests point it at fakes. */
  pathEnv: string;
  run: Runner;
  log: (msg: string) => void;
  /** Overridable endpoints so tests never touch the network. */
  mailUrl: string;
  fetch: typeof fetch;
}

/** The core checkout this code runs from (never the instance: see `hubPaths().home`). */
export const defaultRoot = (): string => CORE_ROOT;

export const defaultRunner = (pathEnv: string): Runner => async (cmd, args, opts = {}) => {
  const r = await execa(cmd, args, {
    reject: false,
    timeout: opts.timeoutMs ?? 30000,
    input: opts.input,
    env: { PATH: pathEnv, ...(opts.env ?? {}) },
    extendEnv: false,
  });
  return { code: r.exitCode ?? (r.timedOut ? 124 : 1), stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
};

export function makeCtx(over: Partial<Ctx> = {}): Ctx {
  const home = over.home ?? process.env.HOME ?? homedir();
  const pathEnv = over.pathEnv ?? process.env.PATH ?? "/usr/bin:/bin";
  // An explicit `root` (tests) is an instance folder; the core is always this checkout. Neither: HUB_HOME, or a HubHomeMissingError.
  const paths = over.paths ?? hubPaths(over.root ? { home: over.root } : {});
  return {
    root: over.root ?? paths.home,
    paths,
    home,
    uid: over.uid ?? process.getuid?.() ?? 501,
    dryRun: over.dryRun ?? false,
    configDir: over.configDir ?? paths.secrets,
    pathEnv,
    run: over.run ?? defaultRunner(pathEnv),
    log: over.log ?? ((m) => console.log(m)),
    mailUrl: over.mailUrl ?? "http://localhost:8787",
    fetch: over.fetch ?? globalThis.fetch,
  };
}

export const readJson = <T = any>(p: string): T | undefined => {
  try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return undefined; }
};

/** Resolve a binary on ctx.pathEnv without spawning. */
export function which(ctx: Ctx, bin: string): string | undefined {
  for (const d of ctx.pathEnv.split(":")) {
    const p = path.join(d, bin);
    if (d && existsSync(p)) return p;
  }
  return undefined;
}

/** `<projects>/<slug>/` folders of the instance; empty when none. */
export function listProjects(ctx: Ctx): string[] {
  const dir = ctx.paths.projects;
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_"))
    .map((d) => d.name).sort();
}
