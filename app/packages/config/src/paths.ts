// The ONE place that knows where the hub's files live (decision 0016). One layout: the core is code, the instance (`HUB_HOME`) is data. Node-only: import it as
// `@hub/config/paths`, never from the browser entry. Every other file asks `hubPaths()`; a gate test
// (`apps/installer/test/home-seams.test.ts`) fails when a file outside this one joins a path to the repo root itself.
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_PORT, SERVER_PORT } from "./index";
import { readInstanceConfig } from "./instance";

/** The checkout this code runs from: where `skills/`, `app/` and `config/mcp.json` ship. Four levels above `app/packages/config/src`. */
export const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export interface HubPaths {
  /** The core checkout (code, skills, templates). Holds no owner data. */
  core: string;
  /** The instance root (`HUB_HOME`): `projects/`, `data/`, `state/`, `config/`, `core.version`. Never the core itself. */
  home: string;
  skills: string;
  templates: string;
  /** The Notion pack the deploy skill builds from: `schema/*.json`, `views/*.json` and the module pages. */
  notionPack: string;
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
  /** Per-project Codex homes (`CODEX_HOME`) of hub sessions: `<state>/codex` (P49 S10; git-ignored, generated). */
  codexHomes: string;
  /** The agent session log (P54): `<state>/log/<slug>/<YYYY-MM-DD>.jsonl`, written by the session hooks, read by `hub log`. */
  log: string;
  /** P86: the ops log, what failed or happened in the server and every package: `<state>/log/ops-<YYYY-MM-DD>.jsonl` (flat files beside the agent log's project folders), written by `@hub/log/ops`, read by `hub logs` and Overview. */
  opsLog: string;
  /** The admin's shared focus (P51): `<state>/focus.json`, ids only, written by the server, read by `hub focus` and `hub mcp`. */
  focus: string;
  /** Decision 0048 (P139): the instance's autopilot switch, `<state>/autopilot.json` `{on}`. Written only by the owner's admin route; protected (an agent session cannot write it). */
  autopilot: string;
  /** The agent's pointer (P72): `<state>/pointer.json`, refs only, written by `hub mcp`'s `highlight`, read by the server's `GET /api/pointer`. */
  pointer: string;
  /** P67: the LaunchAgent's own files: `<state>/autostart/` (`launchd.log`, `starts.jsonl`, the `off` file). */
  autostart: string;
  /** P68: the last answer of the core update check (`<state>/core-update.json`), written by the server, read by the admin and `instance.core`. */
  coreUpdate: string;
  /** P62: what the hub knows of each connector's Google account (`<state>/connectors.json`: stated by the owner, confirmed by a session's read), written by `hub connectors` and the guard's post hook. */
  connectors: string;
  /** P76, decision 0041: the files dropped on a terminal tab, `<state>/drops/<slug or _shell>/<session>/`; emptied at server start, a tab's folder removed when it closes. */
  drops: string;
  secrets: string;
  configDir: string;
  configFile: string;
  /** The instance's list of public lead forms the `Leads` doctor group checks: `<configDir>/lead-forms.json` (tracked, no secrets). */
  leadForms: string;
}

export interface HubPathsOptions {
  env?: NodeJS.ProcessEnv;
  /** Override the core checkout (tests that build a fake tree). */
  core?: string;
  /** Override `HUB_HOME`. */
  home?: string;
  /** Where to look for an instance when `HUB_HOME` is unset (default: the current folder). */
  cwd?: string;
}

/** The file that marks an instance root: the core pin. */
export const INSTANCE_MARKER = "core.version";

/** The nearest folder at or above `start` that holds `core.version`: the instance a command was started inside. `undefined` when there is none. */
export function findInstanceHome(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, INSTANCE_MARKER))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** True when `HUB_HOME` is set (an explicit instance, never overridden by the current folder). */
export const hasExplicitHome = (env: NodeJS.ProcessEnv = process.env): boolean => !!fromEnv(env, "HUB_HOME");

/** `HUB_HOME` is unset: an instance command has no instance to work on. The CLI prints this one line and exits 2. */
export class HubHomeMissingError extends Error {
  constructor() {
    super("no instance: run hub inside an instance folder (one with core.version), or export HUB_HOME");
    this.name = "HubHomeMissingError";
  }
}

/** A leading `~` in a path the OWNER typed (an env var or a config value) means their home. The one place this is spelled; no default of the hub contains a `~`. */
export const expandTilde = (p: string, env: NodeJS.ProcessEnv = process.env): string => p.replace(/^~(?=$|\/)/, env.HOME ?? "~");
const expand = (p: string, env: NodeJS.ProcessEnv): string => resolve(expandTilde(p, env));
const fromEnv = (env: NodeJS.ProcessEnv, name: string): string | undefined => env[name]?.trim() || undefined;

/**
 * Precedence, highest first, per path:
 * - `projects`: `HUB_PROJECTS`, else `<home>/projects`.
 * - `db`: `HUB_DB`, else `<home>/data/app.db`.
 * - `secrets`: `HUB_CONFIG_DIR`, else `<home>/state/secrets`.
 * - `configFile`: `HUB_CONFIG_FILE`, else `<home>/config/config.json`.
 * - `home`: the `home` option, else `HUB_HOME`, else the instance the current folder is inside ({@link findInstanceHome}); none is a {@link HubHomeMissingError}.
 * Everything else is derived from `home` (state, evidence, mcp file, claude skills) or `core` (skills, templates, mcp defaults).
 * A `HUB_HOME` that is not an existing folder, or is the core itself, throws: a typo must not create a second instance silently and the core holds no data.
 */
export function hubPaths(o: HubPathsOptions = {}): HubPaths {
  const env = o.env ?? process.env;
  const core = o.core ? resolve(o.core) : CORE_ROOT;
  const rawHome = o.home ?? fromEnv(env, "HUB_HOME") ?? findInstanceHome(o.cwd ?? process.cwd());
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
    notionPack: join(core, "app", "projects", "_template", "notion-crm"),
    hubBin: join(core, "app", "apps", "installer", "bin", "hub.mjs"),
    mcpDefaults: join(core, "config", "mcp.json"),
    mcpFile: join(home, ".mcp.json"),
    claudeSkills: join(home, ".claude", "skills"),
    projects: fromEnv(env, "HUB_PROJECTS") ? resolve(fromEnv(env, "HUB_PROJECTS")!) : join(home, "projects"),
    db: fromEnv(env, "HUB_DB") ?? join(home, "data", "app.db"),
    state,
    stateProjects: join(state, "projects"),
    evidence: join(state, "evidence"),
    codexHomes: join(state, "codex"),
    log: join(state, "log"),
    opsLog: join(state, "log"),
    focus: join(state, "focus.json"),
    autopilot: join(state, "autopilot.json"),
    pointer: join(state, "pointer.json"),
    autostart: join(state, "autostart"),
    coreUpdate: join(state, "core-update.json"),
    connectors: join(state, "connectors.json"),
    drops: join(state, "drops"),
    secrets: fromEnv(env, "HUB_CONFIG_DIR") ?? join(state, "secrets"),
    configDir,
    configFile: fromEnv(env, "HUB_CONFIG_FILE") ?? join(configDir, "config.json"),
    leadForms: join(configDir, "lead-forms.json"),
  };
}

/**
 * The machine's own Hub folder, shared by every instance on this Mac (P144 W1, owner 2026-11-25: one universal OpenRouter key):
 * `HUB_MACHINE_DIR`, else `$HOME/.config/reforms-hub`. Only the `HOME` of the env handed in counts (never `os.homedir()`), so a
 * test with its own env never reads the owner's real files; no `HOME` gives null.
 */
export function machineDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const own = fromEnv(env, "HUB_MACHINE_DIR");
  if (own) return expand(own, env);
  const home = fromEnv(env, "HOME");
  return home ? join(home, ".config", "reforms-hub") : null;
}

/** `<projects>/<slug>`: one project's folder. */
/** The database is not the instance's own `<home>/data/app.db`: a `HUB_DB` override, which only a throwaway (e2e, a drill) sets. */
export const throwawayDb = (paths: Pick<HubPaths, "home" | "db">): boolean => resolve(paths.db) !== join(paths.home, "data", "app.db");
export const projectFolder = (slug: string, o: HubPathsOptions = {}): string => join(hubPaths(o).projects, slug);

/**
 * The paths of the instance at `home` (the core is this checkout). For code that is handed an instance root rather than the environment
 * (tests build a throw-away instance; the ledger root can be redirected).
 */
export const pathsAt = (home: string, env: NodeJS.ProcessEnv = process.env): HubPaths => hubPaths({ env, home });

/** The user-global skills folder `~/.claude/skills`. The hub only READS it, to report old links an earlier `hub setup` made there (`userHome` is the person's HOME, not the hub's). */
export const userClaudeSkills = (userHome: string): string => join(userHome, ".claude", "skills");

export interface HubPorts { admin: number; api: number }

const portOf = (v: unknown, what: string): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error(`${what} must be a port between 1024 and 65535, got ${String(v)}`);
  return n;
};

/**
 * The two loopback ports of one instance, so two instances can run side by side. Highest first:
 * `HUB_ADMIN_PORT` / `HUB_PORT`, then `admin_port` / `api_port` in the instance's `config/config.json`, then the defaults (5173, 4317).
 * A malformed value is an error, never a silent fallback; an admin and an API on the same port is an error too.
 */
export function instancePorts(paths: Pick<HubPaths, "configFile">, env: NodeJS.ProcessEnv = process.env): HubPorts {
  const cfg = readInstanceConfig(paths).config;
  const admin = portOf(env.HUB_ADMIN_PORT?.trim(), "HUB_ADMIN_PORT") ?? portOf(cfg.admin_port, "config admin_port") ?? ADMIN_PORT;
  const api = portOf(env.HUB_PORT?.trim(), "HUB_PORT") ?? portOf(cfg.api_port, "config api_port") ?? SERVER_PORT;
  if (admin === api) throw new Error(`the admin and the API both use port ${admin}: set different admin_port and api_port in ${paths.configFile}`);
  return { admin, api };
}

export interface InstanceBrand {
  /** `name` of `config/config.json`, trimmed; "Hub" when absent or empty. */
  name: string;
  /** The logo file as an absolute path (a relative `logo` is read from the config folder), or null when none is configured. */
  logo: string | null;
  /** True when a logo is configured and the file exists: the doctor warns otherwise, the admin draws a monogram. */
  logoFound: boolean;
}

/** The fallback the admin shows when the instance names no brand. Kept equal to `DEFAULT_INSTANCE_NAME` of `@hub/contract/instance`. */
export const DEFAULT_BRAND_NAME = "Hub";

/**
 * The instance's brand (P48 W0): optional `name` and `logo` in `config/config.json`. A missing or unreadable file, or a
 * value that is not a non-empty string, falls back (name "Hub", no logo): a brand is never a reason not to start.
 */
export function instanceBrand(paths: Pick<HubPaths, "configFile" | "configDir">): InstanceBrand {
  const cfg = readInstanceConfig(paths).config;
  const name = cfg.name ?? DEFAULT_BRAND_NAME;
  const raw = cfg.logo ?? null;
  const logo = raw === null ? null : isAbsolute(raw) ? raw : resolve(paths.configDir, raw);
  let logoFound = false;
  if (logo) {
    try { logoFound = statSync(logo).isFile(); } catch { logoFound = false; }
  }
  return { name, logo, logoFound };
}

/** Days the agent session log keeps (P54): `log.retention_days` in `config/config.json`, a whole number from 1 to 3650; anything else is the default 90. */
export function instanceLogRetention(paths: Pick<HubPaths, "configFile">): number {
  return readInstanceConfig(paths).config.log?.retention_days ?? 90;
}

/** `<state>/codex/<slug or _unbound>`: the `CODEX_HOME` of one project's Codex sessions (P49), and its `skills/` links. */
export function codexSessionPaths(paths: Pick<HubPaths, "codexHomes">, slug: string | undefined): { home: string; skills: string } {
  const home = join(paths.codexHomes, slug ?? "_unbound");
  return { home, skills: join(home, "skills") };
}

/** The drop folder of the Shell's tabs (no project). */
export const SHELL_DROPS = "_shell";

/** `<state>/drops/<slug or _shell>`, and with `session` that tab's own folder (P76): where the dock copies a dropped file. */
export function dropFolder(paths: Pick<HubPaths, "drops">, slug: string | null | undefined, session?: string): string {
  const project = join(paths.drops, slug ?? SHELL_DROPS);
  return session === undefined ? project : join(project, session);
}

/** The CLIs a hub agent session can run (P49): Claude Code and Codex. */
export const AGENT_CLIS = ["claude", "codex"] as const;
export type AgentCli = (typeof AGENT_CLIS)[number];

export interface InstanceFeatures {
  /**
   * `agent.default`: the CLI `hub agent` and the terminal's `+` start (default claude). There is one permission mode, no
   * switch: every session runs with no prompts and the OS sandbox on (owner 2026-11-25).
   */
  agent: { default: AgentCli };
}

/**
 * The instance's switches in `config/config.json` (P49). Anything that is not exactly the documented value falls back
 * to the safe default (Claude, prompts on): a typo never turns a door open. The embedded terminal has no switch: it is
 * always on (decision 0032); any other key here is ignored (`files.config-keys` names it).
 */
export function instanceFeatures(paths: Pick<HubPaths, "configFile">): InstanceFeatures {
  const agent = readInstanceConfig(paths).config.agent;
  return { agent: { default: agent?.default ?? "claude" } };
}
