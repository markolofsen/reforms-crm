import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AGENT_CLIS, expandTilde, instanceFeatures, pathsAt, type AgentCli, type HubPaths } from "@hub/config/paths";
import { claudeBaseArgs, claudeEnforcementArgs } from "@hub/agent/claude";
import { codexArgs, codexHome } from "@hub/agent/codex";
import { INSTALL_LINE } from "@hub/agent/detect";
import { CLI_LABELS, modeLine } from "@hub/agent/session";
import { bindingPrompt, identityOf, projectsRelOf, UNBOUND_INSTRUCTIONS } from "@hub/agent/session-rules";
import { logStoreOf } from "@hub/log/store";
import { chooseResume, SESSION_ID } from "@hub/log/resume";
import { syncInstanceSkills } from "./instance-skills";
import { readBinding, resolveBinding, writeBinding, writeCodexHome, writeSessionFiles, type SessionFiles } from "./safety";
import { c, UsageError } from "./term";

/** `resume`: one session by id (`--resume <id>`, P64); `continue` resolves the bound project's last logged session into it. */
export type AgentMode = "continue" | "new" | "pick" | "resume";
/** `shell`: the owner's own shell in the instance root, bound to the project (no agent, no sandbox: as Terminal.app). */
export type SessionCli = AgentCli | "shell";
export const SESSION_CLIS: readonly SessionCli[] = [...AGENT_CLIS, "shell"];
export interface AgentPlan { mode: AgentMode; project?: string; extra: string[]; cli?: SessionCli; prepare?: boolean; /** The session id of mode `resume`. */ resume?: string; /** The bound project's Mail identity paragraph (`projectIdentity`), from its project.md. */ identity?: string }

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
 * Mode selection. `hub agent` = continue the bound project's last logged session (P64); `<project>` = a FRESH session bound to it; `new` / `pick` / `continue`
 * name a mode. Everything after (a leading `--` is dropped) goes to claude untouched.
 */
export function parseAgentArgs(args: string[], projects: string[]): AgentPlan {
  // `--cli <x>`, `--prepare` and `--resume <id>` are the hub's own; they may come anywhere before `--`.
  const cut = args.indexOf("--");
  const own = cut === -1 ? args : args.slice(0, cut);
  const tail = cut === -1 ? [] : args.slice(cut);
  let cli: SessionCli | undefined;
  let prepare = false;
  let resume: string | undefined;
  const kept: string[] = [];
  for (let i = 0; i < own.length; i++) {
    const a = own[i] as string;
    const inline = a.startsWith("--cli=") ? a.slice(6) : undefined;
    if (a === "--cli" || inline !== undefined) {
      const v = inline ?? own[++i];
      if (!v || !(SESSION_CLIS as readonly string[]).includes(v)) throw new UsageError(`--cli takes ${SESSION_CLIS.join(", ")}, got "${v ?? ""}"`);
      cli = v as SessionCli;
    } else if (a === "--resume" || a.startsWith("--resume=")) {
      const v = a.startsWith("--resume=") ? a.slice(9) : own[++i];
      if (!v || !SESSION_ID.test(v)) throw new UsageError(`--resume takes a session id (a UUID), got "${v ?? ""}"`);
      resume = v;
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
  if (resume) {
    if (!project) throw new UsageError("--resume needs the project: `hub agent <project> --cli <x> --resume <id>`");
    mode = "resume";
  }
  return { mode, ...(project ? { project } : {}), extra, ...(cli ? { cli } : {}), ...(prepare ? { prepare } : {}), ...(resume ? { resume } : {}) };
}

export function buildClaudeArgs(plan: AgentPlan, dirs: string[] = [], files?: SessionFiles, projectsRel?: string, unattended = false): string[] {
  const base = claudeBaseArgs(unattended, dirs);
  if (files) base.push(...claudeEnforcementArgs(files));
  if (plan.project) base.push("--append-system-prompt", bindingPrompt(plan.project, projectsRel, plan.identity));
  // P64: never `--continue` (it takes the newest conversation of the instance root, any project's); `continue` is resolved to an id first.
  const lead = plan.mode === "pick" ? ["--resume"] : plan.mode === "resume" && plan.resume ? ["--resume", plan.resume] : [];
  return [...lead, ...base, ...plan.extra];
}

/** Codex: `resume <id>` resumes one session, `resume` picks; a fresh session starts plain. The binding is the generated `developer_instructions`. */
export function buildCodexArgs(plan: AgentPlan, paths: HubPaths, unattended: boolean): string[] {
  const lead = plan.mode === "pick" ? ["resume"] : plan.mode === "resume" && plan.resume ? ["resume", plan.resume] : [];
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
  claude: `\`claude\` is not on PATH. Install Claude Code (\`${INSTALL_LINE.claude}\`), then rerun.`,
  codex: `\`codex\` is not on PATH. Install the Codex CLI (\`${INSTALL_LINE.codex}\`), then rerun.`,
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
    const identity = identityOf(env.projectsDir, plan.project); // unreadable project.md: none; the session says so itself
    if (identity) plan.identity = identity;
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
  const relOk = projectsRelOf(env.root, env.projectsDir);
  const instructions = plan.project ? bindingPrompt(plan.project, relOk, plan.identity) : UNBOUND_INSTRUCTIONS;
  // An instance keeps no copy of the core skills: the CLI finds them through generated links.
  const linked = syncInstanceSkills(paths);
  const files = writeSessionFiles(env.root, env.projectsDir, plan.project, process.execPath, paths, unattended);
  let codexHomeDir: string | undefined;
  if (cli === "codex") {
    codexHomeDir = writeCodexHome({ paths, projectsDir: env.projectsDir, slug: plan.project, unattended, nodeBin: process.execPath, instructions });
    childEnv.CODEX_HOME = codexHomeDir;
  }
  if (plan.prepare) {
    console.log(`prepared ${CLI_LABELS[cli]} session files for ${plan.project ?? "an unbound session"}: ${codexHomeDir ?? files.settings}`);
    return 0;
  }

  const resumed = resolveResume(plan, cli, { paths, instructions });
  const run = resumed.plan;

  printPhrases();
  if (linked.length) console.log(c.dim(`Core skills linked into ${paths.claudeSkills}: ${linked.join(", ")}`));
  if (plan.project) {
    console.log(`\n${c.green("Session bound to project:")} ${c.bold(plan.project)} ${c.dim(bound.sticky ? "(kept from the last session; `hub agent new` unbinds)" : run.mode === "resume" ? "(HUB_PROJECT). Resumed: this project's own session, with today's rules." : "(HUB_PROJECT). A fresh session: no other project's context is carried over.")}`);
  }
  if (resumed.line) console.log(c.yellow(resumed.line));
  console.log(c.dim(`${CLI_LABELS[cli]}, ${modeLine(unattended)}.`));
  console.log(c.dim(`Enforced: no send/forward/trash/delete tool (${files.disallowed.length} denied), only the hub's MCP servers, secrets and ${plan.project ? "other projects' folders" : "the live database"} unreadable${cli === "claude" ? `, guard hook ${process.env.HUB_GUARD === "block" ? "BLOCKS" : "warns (HUB_GUARD=block to block)"}` : ", forbidden command rules"}.`));
  console.log();

  const dirs = extraDirs(env.root);
  const start = (p: AgentPlan): Promise<number> =>
    cli === "codex"
      ? spawnCli("codex", "codex", buildCodexArgs(p, paths, unattended), env.root, childEnv)
      : spawnCli("claude", "claude", buildClaudeArgs(p, dirs, files, relOk, unattended), env.root, childEnv);
  return startWithFallback(run, start, { say: (l) => console.log(c.yellow(l)) });
}

/**
 * P64: which session `hub agent` starts. `resume <id>`: that session when the log has it for this project and CLI and it can
 * still be resumed (Codex: with the same rules); `continue`: the project's last logged session, no cut-off. Never the CLI's
 * own `--continue` / `--last` (the instance root is every project's cwd). Anything else, or a refusal: a fresh session.
 */
export function resolveResume(plan: AgentPlan, cli: AgentCli, o: { paths: HubPaths; instructions: string; now?: Date }): { plan: AgentPlan; line: string | null } {
  if (plan.mode !== "resume" && plan.mode !== "continue") return { plan, line: null };
  const fresh = (line: string | null) => ({ plan: freshPlan(plan), line });
  const project = plan.project ?? null;
  const choice = chooseResume(logStoreOf(o.paths), {
    project,
    cli,
    maxAgeMs: Infinity, // `continue` is his own explicit ask; the dock's 24 h cut-off is the server's (it passes an id)
    ...(plan.mode === "resume" && plan.resume ? { id: plan.resume } : {}),
    ...(cli === "codex" ? { within: codexHome(o.paths, plan.project), instructions: o.instructions } : {}),
    ...(o.now ? { now: o.now } : {}),
  });
  if (!choice.session) return fresh(choice.why ? `Not resumed: ${choice.why}. A fresh session.` : plan.mode === "continue" ? "No earlier session of this project to continue: a fresh session." : null);
  return { plan: { ...plan, mode: "resume", resume: choice.session.session }, line: null };
}

/** The same plan as a fresh session. */
const freshPlan = ({ resume: _, ...rest }: AgentPlan): AgentPlan => ({ ...rest, mode: "new" });

/** A resume that the CLI refuses fails at once (Claude "No conversation found", exit 1 in about 4 s; Codex "no rollout found", 1.7 s). */
export const RESUME_FAIL_MS = 15_000;

/**
 * Starts the plan; a resume whose CLI exits non-zero within {@link RESUME_FAIL_MS} gets ONE fresh start, said in one line. A
 * resumed session that ran longer is never restarted.
 */
export async function startWithFallback(plan: AgentPlan, start: (p: AgentPlan) => Promise<number>, o: { say: (line: string) => void; now?: () => number; failMs?: number }): Promise<number> {
  const now = o.now ?? Date.now;
  const t0 = now();
  const code = await start(plan);
  if (plan.mode !== "resume" || code === 0 || now() - t0 > (o.failMs ?? RESUME_FAIL_MS)) return code;
  o.say(`Could not resume session ${(plan.resume ?? "").slice(0, 8)} (exit ${code}): a fresh session.`);
  return start(freshPlan(plan));
}
