import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AGENT_CLIS, expandTilde, instanceFeatures, pathsAt, type AgentCli, type HubPaths } from "@hub/config/paths";
import { claudeBaseArgs, claudeEnforcementArgs } from "@hub/agent/claude";
import { codexArgs } from "@hub/agent/codex";
import { CLI_LABELS, modeLine } from "@hub/agent/session";
import { projectIdentity, sessionRules } from "@hub/agent/session-rules";
import { loadProject } from "@hub/projects";
import { syncInstanceSkills } from "./instance-skills";
import { readBinding, resolveBinding, writeBinding, writeCodexHome, writeSessionFiles, type SessionFiles } from "./safety";
import { c, UsageError } from "./term";

export type AgentMode = "continue" | "new" | "pick";
/** `shell`: the owner's own shell in the instance root, bound to the project (no agent, no sandbox: as Terminal.app). */
export type SessionCli = AgentCli | "shell";
export const SESSION_CLIS: readonly SessionCli[] = [...AGENT_CLIS, "shell"];
export interface AgentPlan { mode: AgentMode; project?: string; extra: string[]; cli?: SessionCli; prepare?: boolean; /** The bound project's Mail identity paragraph (`projectIdentity`), from its project.md. */ identity?: string }

const MODES: readonly string[] = ["continue", "new", "pick"];

/** The owner's phrases, one per skill. Full list: skills/README.md. */
export const PHRASES: ReadonlyArray<readonly [phrase: string, what: string]> = [
  ["разбери почту проекта <X>", "triage-mail: read new client mail, update Notion, leave unsent drafts"],
  ["обработай письмо от <адрес> в проекте <X>", "mail-client-chain: one client, whole history, one draft"],
  ["сделай follow-up для клиентов <X>: <кому>", "bulk-drafts: one draft per client, never sent"],
  ["настрой проект <X>", "project-setup: a short interview, writes <X>/project.md in the projects folder"],
  ["загрузи знания проекта <X>", "knowledge-import: fill and index the project's knowledge base"],
  ["разверни CRM проекта <X> в Notion", "notion-project-deploy: dry run first, then your go"],
];

/** Projects the owner can bind a session to: <projects>/<slug>/ with a project.md, folders starting with `_` are templates. */
export function listProjects(projectsDir: string): string[] {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && existsSync(path.join(projectsDir, e.name, "project.md")))
    .map((e) => e.name)
    .sort();
}

/**
 * Mode selection. `hub agent` = continue the last session; `<project>` = a FRESH session bound to it; `new` / `pick` / `continue`
 * name a mode. Everything after (a leading `--` is dropped) goes to claude untouched.
 */
export function parseAgentArgs(args: string[], projects: string[]): AgentPlan {
  // `--cli <x>` and `--prepare` are the hub's own; they may come anywhere before `--`.
  const cut = args.indexOf("--");
  const own = cut === -1 ? args : args.slice(0, cut);
  const tail = cut === -1 ? [] : args.slice(cut);
  let cli: SessionCli | undefined;
  let prepare = false;
  const kept: string[] = [];
  for (let i = 0; i < own.length; i++) {
    const a = own[i] as string;
    const inline = a.startsWith("--cli=") ? a.slice(6) : undefined;
    if (a === "--cli" || inline !== undefined) {
      const v = inline ?? own[++i];
      if (!v || !(SESSION_CLIS as readonly string[]).includes(v)) throw new UsageError(`--cli takes ${SESSION_CLIS.join(", ")}, got "${v ?? ""}"`);
      cli = v as SessionCli;
    } else if (a === "--prepare") prepare = true;
    else kept.push(a);
  }
  const rest0 = [...kept, ...tail];
  const [first, ...rest] = rest0;
  let mode: AgentMode = "continue";
  let project: string | undefined;
  let extra = rest0;
  if (first !== undefined && !first.startsWith("-")) {
    extra = rest;
    if (MODES.includes(first)) mode = first as AgentMode;
    else if (projects.includes(first)) { project = first; mode = "new"; }
    else {
      throw new UsageError(`unknown project or mode "${first}". Projects: ${projects.length ? projects.join(", ") : "(none)"}. Modes: ${MODES.join(", ")}.`);
    }
  }
  if (extra[0] === "--") extra = extra.slice(1);
  return { mode, ...(project ? { project } : {}), extra, ...(cli ? { cli } : {}), ...(prepare ? { prepare } : {}) };
}

/**
 * The system prompt that pins a session to one project (isolation: one session = one project), then the core's session rules
 * (P51: what "this client" means, the focus, revise never send). The same text goes to Claude and to Codex.
 */
export function bindingPrompt(project: string, projectsRel = "projects", identity?: string): string {
  return `This session is bound to ONE project: ${project} (HUB_PROJECT). Work for ${project} only: read ${projectsRel}/${project}/ and no other project's folder, name only that project's Mail accounts, pass project=${project} to every knowledge call. If asked for another project, refuse and tell the owner to run \`hub agent <other>\`. Drafts only: never send.\n\n${sessionRules(project)}${identity ? `\n\n${identity}` : ""}`;
}

export function buildClaudeArgs(plan: AgentPlan, dirs: string[] = [], files?: SessionFiles, projectsRel?: string, unattended = false): string[] {
  const base = claudeBaseArgs(unattended, dirs);
  if (files) base.push(...claudeEnforcementArgs(files));
  if (plan.project) base.push("--append-system-prompt", bindingPrompt(plan.project, projectsRel, plan.identity));
  const lead = plan.mode === "pick" ? ["--resume"] : plan.mode === "continue" ? ["--continue"] : [];
  return [...lead, ...base, ...plan.extra];
}

/** Codex: `resume --last` continues, `resume` picks; a fresh session starts plain. The binding is the generated `developer_instructions`. */
export function buildCodexArgs(plan: AgentPlan, paths: HubPaths, unattended: boolean): string[] {
  const lead = plan.mode === "pick" ? ["resume"] : plan.mode === "continue" ? ["resume", "--last"] : [];
  return [...lead, ...codexArgs({ paths, unattended, extra: plan.extra })];
}

/**
 * Extra folders Claude may read, none by default (the hub never assumes an owner's workspace layout):
 * `HUB_EXTRA_DIRS` (colon-separated) and/or `extra_dirs` in `config/config.json`. Folders that do not exist are dropped.
 */
export function extraDirs(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = (env.HUB_EXTRA_DIRS ?? "").split(":").map((d) => d.trim()).filter(Boolean);
  let fromFile: string[] = [];
  try {
    const j = JSON.parse(readFileSync(pathsAt(root).configFile, "utf8")) as { extra_dirs?: unknown };
    if (Array.isArray(j.extra_dirs)) fromFile = j.extra_dirs.filter((d): d is string => typeof d === "string" && d.trim() !== "");
  } catch { /* no config file: no extra folders */ }
  return [...new Set([...fromEnv, ...fromFile].map((d) => path.resolve(root, expandTilde(d, env))))].filter((d) => existsSync(d));
}

export function printPhrases(log: (s: string) => void = console.log): void {
  log(c.bold("Say ONE of these") + c.dim(" (full list and details: skills/README.md)"));
  const w = Math.max(...PHRASES.map(([p]) => p.length));
  for (const [p, what] of PHRASES) log(`  ${c.cyan(p.padEnd(w))}  ${c.dim(what)}`);
  log(c.dim("Drafts only, nothing is ever sent. One session = one project: `hub agent <X>` binds it."));
}

const INSTALL: Record<SessionCli, string> = {
  claude: "`claude` is not on PATH. Install Claude Code (https://claude.com/claude-code), then rerun.",
  codex: "`codex` is not on PATH. Install the Codex CLI (`npm i -g @openai/codex`), then rerun.",
  shell: "the shell in $SHELL could not start.",
};

const spawnCli = (cli: SessionCli, cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: "inherit" });
    const ignore = () => {}; // Ctrl-C belongs to the program; we wait for it to exit
    process.on("SIGINT", ignore);
    child.on("error", (e: NodeJS.ErrnoException) => {
      process.off("SIGINT", ignore);
      reject(e.code === "ENOENT" ? new UsageError(INSTALL[cli]) : e);
    });
    child.on("exit", (code, signal) => {
      process.off("SIGINT", ignore);
      resolve(code ?? (signal ? 130 : 1));
    });
  });

/** The core's own CLI entry (`bin/hub.mjs`) of this checkout. */
export const HUB_BIN = fileURLToPath(new URL("../bin/hub.mjs", import.meta.url));

/**
 * `<state>/bin/hub`: a two-line shim a session finds on PATH, so `hub ...` runs this instance's pinned core on this Node with
 * this `HUB_HOME`, inside the sandbox too (it only executes files the session may already read). Rewritten at every start.
 */
export function hubShimDir(paths: HubPaths, node: string, bin: string = HUB_BIN): string {
  const dir = path.join(paths.state, "bin");
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "hub"), `#!/bin/sh\n# Generated by \`hub agent\` (P52): the hub CLI of this instance. Do not edit.\nHUB_HOME=\${HUB_HOME:-${q(paths.home)}} exec ${q(node)} ${q(bin)} "$@"\n`);
  chmodSync(path.join(dir, "hub"), 0o755);
  return dir;
}

/** `root` is the instance root (where the CLI starts); `home` is the user's home folder; `paths` is what `hubPaths()` resolved. */
export interface AgentEnv { root: string; home: string; projectsDir: string; paths?: HubPaths }

/**
 * `hub agent [project] [--cli claude|codex|shell] [--prepare]`. Starts the instance's default CLI (`agent.default`) in the
 * instance root, bound to one project, in the instance's mode (`agent.unattended`: no prompts, OS sandbox on). The cwd of the
 * caller does not matter. `--prepare` writes the session files and starts nothing (the Agent tools fix line).
 */
export async function runAgent(env: AgentEnv, argv: string[]): Promise<number> {
  const parsed = parseAgentArgs(argv, listProjects(env.projectsDir));
  let bound: { project?: string; sticky: boolean };
  try { bound = resolveBinding({ mode: parsed.mode, requested: parsed.project, stored: readBinding(env.root), envProject: process.env.HUB_PROJECT }); }
  catch (e) { throw new UsageError((e as Error).message); }
  const plan: AgentPlan = { ...parsed, ...(bound.project ? { project: bound.project } : {}) };
  if (plan.project) {
    try {
      const m = loadProject(env.projectsDir, plan.project).parsed.config.mail;
      plan.identity = projectIdentity(plan.project, m);
    } catch { /* an unreadable project.md: the session says so itself when it reads it */ }
  }
  const paths = env.paths ?? pathsAt(env.root);
  const features = instanceFeatures(paths);
  const cli: SessionCli = plan.cli ?? features.agent.default;
  const unattended = features.agent.unattended;
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...(plan.project ? { HUB_PROJECT: plan.project } : {}), HUB_HOME: paths.home };
  // `hub` itself (P52: the skills and rules say `hub record-draft`), then the Node this hub runs on, go first on PATH, so
  // `hub`, `./run.sh` and `node` in the session are this instance's core on the Node the hub needs.
  childEnv.PATH = [hubShimDir(paths, process.execPath), path.dirname(process.execPath), childEnv.PATH ?? ""].filter(Boolean).join(path.delimiter);

  if (cli === "shell") {
    if (plan.prepare) return 0;
    console.log(c.dim(`Shell in ${paths.home}${plan.project ? `, HUB_PROJECT=${plan.project}` : ""}. Not sandboxed: your own shell.`));
    return spawnCli("shell", process.env.SHELL || "/bin/zsh", ["-l", "-i"], env.root, childEnv);
  }

  // `--prepare` (the Agent tools fix line) writes the session files only: it does not move the sticky binding.
  if (!plan.prepare) writeBinding(env.root, plan.project);
  const projectsRel = path.relative(env.root, env.projectsDir).split(path.sep).join("/");
  const relOk = projectsRel && !projectsRel.startsWith("..") ? projectsRel : env.projectsDir;
  // An instance keeps no copy of the core skills: the CLI finds them through generated links.
  const linked = syncInstanceSkills(paths);
  const files = writeSessionFiles(env.root, env.projectsDir, plan.project, process.execPath, paths, unattended);
  let codexHomeDir: string | undefined;
  if (cli === "codex") {
    codexHomeDir = writeCodexHome({ paths, projectsDir: env.projectsDir, slug: plan.project, unattended, nodeBin: process.execPath, instructions: plan.project ? bindingPrompt(plan.project, relOk, plan.identity) : "This hub session is not bound to a project: ask which project, then tell the owner to run `hub agent <project>`. Drafts only: never send." });
    childEnv.CODEX_HOME = codexHomeDir;
  }
  if (plan.prepare) {
    console.log(`prepared ${CLI_LABELS[cli]} session files for ${plan.project ?? "an unbound session"}: ${codexHomeDir ?? files.settings}`);
    return 0;
  }

  printPhrases();
  if (linked.length) console.log(c.dim(`Core skills linked into ${paths.claudeSkills}: ${linked.join(", ")}`));
  if (plan.project) {
    console.log(`\n${c.green("Session bound to project:")} ${c.bold(plan.project)} ${c.dim(bound.sticky ? "(kept from the last session; `hub agent new` unbinds)" : "(HUB_PROJECT). A fresh session: no other project's context is carried over.")}`);
  }
  console.log(c.dim(`${CLI_LABELS[cli]}, ${modeLine(unattended)}.`));
  console.log(c.dim(`Enforced: no send/forward/trash/delete tool (${files.disallowed.length} denied), only the hub's MCP servers, secrets and ${plan.project ? "other projects' folders" : "the live database"} unreadable${cli === "claude" ? `, guard hook ${process.env.HUB_GUARD === "block" ? "BLOCKS" : "warns (HUB_GUARD=block to block)"}` : ", forbidden command rules"}.`));
  console.log();

  if (cli === "codex") {
    const code = await spawnCli("codex", "codex", buildCodexArgs(plan, paths, unattended), env.root, childEnv);
    if (code === 0 || plan.mode !== "continue") return code;
    return spawnCli("codex", "codex", buildCodexArgs({ ...plan, mode: "new" }, paths, unattended), env.root, childEnv);
  }
  const dirs = extraDirs(env.root);
  const args = buildClaudeArgs(plan, dirs, files, relOk, unattended);
  if (plan.mode === "continue") {
    const code = await spawnCli("claude", "claude", args, env.root, childEnv);
    if (code === 0) return 0;
    // nothing to continue (first run here): a fresh session
    return spawnCli("claude", "claude", buildClaudeArgs({ ...plan, mode: "new" }, dirs, files, relOk, unattended), env.root, childEnv);
  }
  return spawnCli("claude", "claude", args, env.root, childEnv);
}
