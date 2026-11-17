import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expandTilde, pathsAt, type HubPaths } from "@hub/config/paths";
import { syncInstanceSkills } from "./instance-skills";
import { enforcementArgs, readBinding, resolveBinding, writeBinding, writeSessionFiles, type SessionFiles } from "./safety";
import { c, UsageError } from "./term";

export type AgentMode = "continue" | "new" | "pick";
export interface AgentPlan { mode: AgentMode; project?: string; extra: string[] }

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
  const [first, ...rest] = args;
  let mode: AgentMode = "continue";
  let project: string | undefined;
  let extra = args;
  if (first !== undefined && !first.startsWith("-")) {
    extra = rest;
    if (MODES.includes(first)) mode = first as AgentMode;
    else if (projects.includes(first)) { project = first; mode = "new"; }
    else {
      throw new UsageError(`unknown project or mode "${first}". Projects: ${projects.length ? projects.join(", ") : "(none)"}. Modes: ${MODES.join(", ")}.`);
    }
  }
  if (extra[0] === "--") extra = extra.slice(1);
  return { mode, ...(project ? { project } : {}), extra };
}

/** The system prompt that pins a session to one project (isolation: one session = one project). */
export function bindingPrompt(project: string, projectsRel = "projects"): string {
  return `This session is bound to ONE project: ${project} (HUB_PROJECT). Work for ${project} only: read ${projectsRel}/${project}/ and no other project's folder, name only that project's Mail accounts, pass project=${project} to every knowledge call. If asked for another project, refuse and tell the owner to run \`hub agent <other>\`. Drafts only: never send.`;
}

/** Fixed flags: no permission prompts (the owner's standing decision for this local project), Chrome for web/Notion checks. */
export function baseClaudeArgs(extraDirs: string[] = []): string[] {
  return ["--dangerously-skip-permissions", "--chrome", ...extraDirs.flatMap((d) => ["--add-dir", d])];
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

export function buildClaudeArgs(plan: AgentPlan, dirs: string[] = [], files?: SessionFiles, projectsRel?: string): string[] {
  const base = baseClaudeArgs(dirs);
  if (files) base.push(...enforcementArgs(files));
  if (plan.project) base.push("--append-system-prompt", bindingPrompt(plan.project, projectsRel));
  const lead = plan.mode === "pick" ? ["--resume"] : plan.mode === "continue" ? ["--continue"] : [];
  return [...lead, ...base, ...plan.extra];
}

export function printPhrases(log: (s: string) => void = console.log): void {
  log(c.bold("Say ONE of these") + c.dim(" (full list and details: skills/README.md)"));
  const w = Math.max(...PHRASES.map(([p]) => p.length));
  for (const [p, what] of PHRASES) log(`  ${c.cyan(p.padEnd(w))}  ${c.dim(what)}`);
  log(c.dim("Drafts only, nothing is ever sent. One session = one project: `hub agent <X>` binds it."));
}

const spawnClaude = (args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, env, stdio: "inherit" });
    const ignore = () => {}; // Ctrl-C belongs to claude; we wait for it to exit
    process.on("SIGINT", ignore);
    child.on("error", (e: NodeJS.ErrnoException) => {
      process.off("SIGINT", ignore);
      reject(e.code === "ENOENT" ? new UsageError("`claude` is not on PATH. Install Claude Code (https://claude.com/claude-code), then rerun.") : e);
    });
    child.on("exit", (code, signal) => {
      process.off("SIGINT", ignore);
      resolve(code ?? (signal ? 130 : 1));
    });
  });

/** `root` is the instance root (where claude starts); `home` is the user's home folder; `paths` is what `hubPaths()` resolved. */
export interface AgentEnv { root: string; home: string; projectsDir: string; paths?: HubPaths }

/** Start Claude Code in the instance root. The cwd of the caller does not matter. */
export async function runAgent(env: AgentEnv, argv: string[]): Promise<number> {
  const parsed = parseAgentArgs(argv, listProjects(env.projectsDir));
  let bound: { project?: string; sticky: boolean };
  try { bound = resolveBinding({ mode: parsed.mode, requested: parsed.project, stored: readBinding(env.root), envProject: process.env.HUB_PROJECT }); }
  catch (e) { throw new UsageError((e as Error).message); }
  const plan: AgentPlan = { ...parsed, ...(bound.project ? { project: bound.project } : {}) };
  writeBinding(env.root, plan.project);
  const dirs = extraDirs(env.root);
  const paths = env.paths ?? pathsAt(env.root);
  // An instance keeps no copy of the core skills: claude finds them through generated links in <instance>/.claude/skills.
  const linked = syncInstanceSkills(paths);
  const files = writeSessionFiles(env.root, env.projectsDir, plan.project, process.execPath, paths);
  const projectsRel = path.relative(env.root, env.projectsDir).split(path.sep).join("/");
  const relOk = projectsRel && !projectsRel.startsWith("..") ? projectsRel : env.projectsDir;
  const args = buildClaudeArgs(plan, dirs, files, relOk);
  const childEnv = { ...process.env, ...(plan.project ? { HUB_PROJECT: plan.project } : {}), HUB_HOME: paths.home };

  printPhrases();
  if (linked.length) console.log(c.dim(`Core skills linked into ${paths.claudeSkills}: ${linked.join(", ")}`));
  if (plan.project) {
    console.log(`\n${c.green("Session bound to project:")} ${c.bold(plan.project)} ${c.dim(bound.sticky ? "(kept from the last session; `hub agent new` unbinds)" : "(HUB_PROJECT). A fresh session: no other project's context is carried over.")}`);
  }
  console.log(c.dim(`Enforced: no send/forward/trash/delete tool (${files.disallowed.length} denied), only the hub's MCP servers, secrets and ${plan.project ? "other projects' folders" : "the live database"} unreadable, guard hook ${process.env.HUB_GUARD === "block" ? "BLOCKS" : "warns (HUB_GUARD=block to block)"}.`));
  console.log();

  if (plan.mode === "continue") {
    const code = await spawnClaude(args, env.root, childEnv);
    if (code === 0) return 0;
    // nothing to continue (first run here): a fresh session
    return spawnClaude(buildClaudeArgs({ ...plan, mode: "new" }, dirs, files, relOk), env.root, childEnv);
  }
  return spawnClaude(args, env.root, childEnv);
}
