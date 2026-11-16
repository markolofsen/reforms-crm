// The ONE place that knows where the hub's files live (decision 0016, plan P33 phase S1). Node-only: import it as
// `@hub/config/paths`, never from the browser entry. Every other file asks `hubPaths()`; a gate test
// (`apps/installer/test/home-seams.test.ts`) fails when a file outside this one joins a path to the repo root itself.
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout this code runs from: where `skills/`, `app/` and `config/mcp.json` ship. Four levels above `app/packages/config/src`. */
export const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export interface HubPaths {
  /** The core checkout (code, skills, templates). Never holds an owner's projects once the split is done. */
  core: string;
  /** The instance root: projects, state, config, data. Equals `core` while `HUB_HOME` is unset (the single-repo layout). */
  home: string;
  /** True when `home` is not `core`: the instance layout (`projects/`, `data/` at the top) instead of the legacy one (`app/projects`, `app/data`). */
  instance: boolean;
  skills: string;
  templates: string;
  /** The `hub` CLI entry of the core checkout. */
  hubBin: string;
  /** The shipped MCP defaults, `<core>/config/mcp.json`. */
  mcpDefaults: string;
  /** The instance's generated MCP file, `<home>/.mcp.json` (git-ignored). */
  mcpFile: string;
  /** Skill discovery for agents started in `home`: `<home>/.claude/skills` (generated symlinks into `<core>/skills`). */
  claudeSkills: string;
  projects: string;
  db: string;
  state: string;
  /** Per-project session state: `<state>/projects`. */
  stateProjects: string;
  /** Per-project evidence ledger root: `<state>/evidence`. */
  evidence: string;
  guardLog: string;
  secrets: string;
  configDir: string;
  configFile: string;
}

export interface HubPathsOptions {
  env?: NodeJS.ProcessEnv;
  /** Override the core checkout (tests that build a fake tree). */
  core?: string;
  /** Override `HUB_HOME`. When it equals `core` the legacy layout applies. */
  home?: string;
}

const expand = (p: string, env: NodeJS.ProcessEnv): string => resolve(p.replace(/^~(?=$|\/)/, env.HOME ?? "~"));
const fromEnv = (env: NodeJS.ProcessEnv, name: string): string | undefined => env[name]?.trim() || undefined;

/**
 * Precedence, highest first, per path:
 * - `projects`: `HUB_PROJECTS`, else `<home>/app/projects` (legacy) or `<home>/projects` (instance).
 * - `db`: `HUB_DB`, else `<home>/app/data/app.db` (legacy) or `<home>/data/app.db` (instance).
 * - `secrets`: `HUB_CONFIG_DIR`, else `<home>/state/secrets`.
 * - `configFile`: `HUB_CONFIG_FILE`, else `<home>/config/config.json`.
 * - `home`: the `home` option, else `HUB_HOME`, else `core`.
 * Everything else is derived from `home` (state, evidence, mcp file, claude skills) or `core` (skills, templates, mcp defaults).
 * A `HUB_HOME` that is not an existing folder throws: a typo must not create a second instance silently.
 */
export function hubPaths(o: HubPathsOptions = {}): HubPaths {
  const env = o.env ?? process.env;
  const core = o.core ? resolve(o.core) : CORE_ROOT;
  const rawHome = o.home ?? fromEnv(env, "HUB_HOME");
  const home = rawHome ? (isAbsolute(rawHome) ? resolve(rawHome) : expand(rawHome, env)) : core;
  if (home !== core && !(existsSync(home) && statSync(home).isDirectory())) throw new Error(`HUB_HOME is not a folder: ${home}`);
  const instance = home !== core;
  const app = instance ? home : join(home, "app");
  const state = join(home, "state");
  const configDir = join(home, "config");
  return {
    core, home, instance,
    skills: join(core, "skills"),
    templates: join(core, "app", "apps", "installer", "templates"),
    hubBin: join(core, "app", "apps", "installer", "bin", "hub.mjs"),
    mcpDefaults: join(core, "config", "mcp.json"),
    mcpFile: join(home, ".mcp.json"),
    claudeSkills: join(home, ".claude", "skills"),
    projects: fromEnv(env, "HUB_PROJECTS") ? resolve(fromEnv(env, "HUB_PROJECTS")!) : join(app, "projects"),
    db: fromEnv(env, "HUB_DB") ?? join(app, "data", "app.db"),
    state,
    stateProjects: join(state, "projects"),
    evidence: join(state, "evidence"),
    guardLog: join(state, "guard.log"),
    secrets: fromEnv(env, "HUB_CONFIG_DIR") ?? join(state, "secrets"),
    configDir,
    configFile: fromEnv(env, "HUB_CONFIG_FILE") ?? join(configDir, "config.json"),
  };
}

/** `<projects>/<slug>`: one project's folder. */
export const projectFolder = (slug: string, o: HubPathsOptions = {}): string => join(hubPaths(o).projects, slug);

/**
 * The home-relative files (state, evidence, secrets, config, `.mcp.json`) of a bare folder, in the legacy layout. For code that is handed a
 * `root` (tests build a fake tree; the ledger root can be redirected) and needs only those files. Projects and the database depend on the
 * layout and on `HUB_PROJECTS` / `HUB_DB`: use {@link hubPaths} for them.
 */
export const pathsAt = (root: string, env: NodeJS.ProcessEnv = process.env): HubPaths => hubPaths({ env, core: root, home: root });

/** The user-global skills folder `~/.claude/skills`, where `hub setup` links the core skills for every folder (`userHome` is the person's HOME, not the hub's). */
export const userClaudeSkills = (userHome: string): string => join(userHome, ".claude", "skills");
