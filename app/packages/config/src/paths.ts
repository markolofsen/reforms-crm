// The ONE place that knows where the hub's files live (decision 0016). One layout: the core is code, the instance (`HUB_HOME`) is data. Node-only: import it as
// `@hub/config/paths`, never from the browser entry. Every other file asks `hubPaths()`; a gate test
// (`apps/installer/test/home-seams.test.ts`) fails when a file outside this one joins a path to the repo root itself.
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout this code runs from: where `skills/`, `app/` and `config/mcp.json` ship. Four levels above `app/packages/config/src`. */
export const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export interface HubPaths {
  /** The core checkout (code, skills, templates). Holds no owner data. */
  core: string;
  /** The instance root (`HUB_HOME`): `projects/`, `data/`, `state/`, `config/`, `core.version`. Never the core itself. */
  home: string;
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
  /** Override `HUB_HOME`. */
  home?: string;
}

/** `HUB_HOME` is unset: an instance command has no instance to work on. The CLI prints this one line and exits 2. */
export class HubHomeMissingError extends Error {
  constructor() {
    super("HUB_HOME is not set: run ./run.sh from an instance folder, or export HUB_HOME");
    this.name = "HubHomeMissingError";
  }
}

const expand = (p: string, env: NodeJS.ProcessEnv): string => resolve(p.replace(/^~(?=$|\/)/, env.HOME ?? "~"));
const fromEnv = (env: NodeJS.ProcessEnv, name: string): string | undefined => env[name]?.trim() || undefined;

/**
 * Precedence, highest first, per path:
 * - `projects`: `HUB_PROJECTS`, else `<home>/projects`.
 * - `db`: `HUB_DB`, else `<home>/data/app.db`.
 * - `secrets`: `HUB_CONFIG_DIR`, else `<home>/state/secrets`.
 * - `configFile`: `HUB_CONFIG_FILE`, else `<home>/config/config.json`.
 * - `home`: the `home` option, else `HUB_HOME`; neither is a {@link HubHomeMissingError}.
 * Everything else is derived from `home` (state, evidence, mcp file, claude skills) or `core` (skills, templates, mcp defaults).
 * A `HUB_HOME` that is not an existing folder, or is the core itself, throws: a typo must not create a second instance silently and the core holds no data.
 */
export function hubPaths(o: HubPathsOptions = {}): HubPaths {
  const env = o.env ?? process.env;
  const core = o.core ? resolve(o.core) : CORE_ROOT;
  const rawHome = o.home ?? fromEnv(env, "HUB_HOME");
  if (!rawHome) throw new HubHomeMissingError();
  const home = isAbsolute(rawHome) ? resolve(rawHome) : expand(rawHome, env);
  if (!(existsSync(home) && statSync(home).isDirectory())) throw new Error(`HUB_HOME is not a folder: ${home}`);
  if (home === core) throw new Error(`HUB_HOME is the core checkout itself (${home}): the core holds no data, point HUB_HOME at an instance folder`);
  const state = join(home, "state");
  const configDir = join(home, "config");
  return {
    core, home,
    skills: join(core, "skills"),
    templates: join(core, "app", "apps", "installer", "templates"),
    hubBin: join(core, "app", "apps", "installer", "bin", "hub.mjs"),
    mcpDefaults: join(core, "config", "mcp.json"),
    mcpFile: join(home, ".mcp.json"),
    claudeSkills: join(home, ".claude", "skills"),
    projects: fromEnv(env, "HUB_PROJECTS") ? resolve(fromEnv(env, "HUB_PROJECTS")!) : join(home, "projects"),
    db: fromEnv(env, "HUB_DB") ?? join(home, "data", "app.db"),
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
 * The paths of the instance at `home` (the core is this checkout). For code that is handed an instance root rather than the environment
 * (tests build a throw-away instance; the ledger root can be redirected).
 */
export const pathsAt = (home: string, env: NodeJS.ProcessEnv = process.env): HubPaths => hubPaths({ env, home });

/** The user-global skills folder `~/.claude/skills`, where `hub setup` links the core skills for every folder (`userHome` is the person's HOME, not the hub's). */
export const userClaudeSkills = (userHome: string): string => join(userHome, ".claude", "skills");
