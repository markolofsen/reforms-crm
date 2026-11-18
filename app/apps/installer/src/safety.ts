import { slimMessageContent } from "./slim-headers";
import { pathsAt, type HubPaths } from "@hub/config/paths";
import { auditToolCalls, defaultProjectsRoot, type AuditLayout, kindOf, loadProject, preDraftCheck, type SkillScope, type ToolCall } from "@hub/projects";
import { instanceServer } from "./mcp-servers";
import { claudeDisallowed, claudeSettings, type ClaudeFiles } from "@hub/agent/claude";
import { codexConfigToml, codexHome, codexRules } from "@hub/agent/codex";
import { HUB_MCP_SERVERS } from "@hub/agent/deny";
import { readSession, recordPost, type PostPayload } from "./evidence-store";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

// Tool-level safety of `hub agent` (plans p17 and P49). What each CLI gets is built in `@hub/agent` (one source for the launcher,
// the doctor and the server); this file writes it. Layers: (1) deny rules and disallowed tools, (2) the hub's MCP servers only
// (Claude --strict-mcp-config, Codex its own CODEX_HOME), (3) the PreToolUse guard `hub guard` (warn by default, HUB_GUARD=block
// to refuse), (4) in unattended mode the OS sandbox (no network, no Apple Events, the policy and config read-only).

export const stateDir = (root: string) => pathsAt(root).stateProjects;
export const slugDir = (root: string, slug: string | undefined) => path.join(stateDir(root), slug ?? "_unbound");

export type SessionFiles = ClaudeFiles & { rules: string[] };

/** The instance's MCP servers, made absolute for it: `.mcp.json`, else `config/mcp.json`, else the core's defaults. */
export function instanceMcpServers(paths: HubPaths, slug: string | undefined): Record<string, Record<string, unknown>> {
  const src = [paths.mcpFile, path.join(paths.configDir, "mcp.json"), paths.mcpDefaults].find((f) => existsSync(f));
  const all = src ? ((JSON.parse(readFileSync(src, "utf8")) as { mcpServers?: Record<string, Record<string, unknown>> }).mcpServers ?? {}) : {};
  const servers: Record<string, Record<string, unknown>> = {};
  for (const name of HUB_MCP_SERVERS) {
    if (!all[name]) continue;
    const s = instanceServer(all[name], paths);
    if (name === "knowledge-mcp" && slug) s.env = { ...(s.env as object), HUB_PROJECT: slug };
    servers[name] = s;
  }
  return servers;
}

/** Writes state/projects/<slug|_unbound>/{settings.json,mcp.json} (git-ignored: state/*) and returns what to pass to claude. */
export function writeSessionFiles(root: string, projectsDir: string, slug: string | undefined, nodeBin = process.execPath, paths: HubPaths = pathsAt(root), unattended = false): SessionFiles {
  const dir = slugDir(root, slug);
  mkdirSync(dir, { recursive: true });
  const settings = claudeSettings({ paths, projectsDir, slug, nodeBin, unattended });
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  const mcpFile = path.join(dir, "mcp.json");
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: instanceMcpServers(paths, slug) }, null, 2) + "\n");
  return { settings: settingsFile, mcp: mcpFile, disallowed: claudeDisallowed(), rules: (settings.permissions as { deny: string[] }).deny };
}

/** The owner's own Codex folder: where `auth.json` lives (`CODEX_HOME` of the caller, else `~/.codex`). */
const ownerCodexHome = (env: NodeJS.ProcessEnv): string => env.CODEX_HOME?.trim() || path.join(env.HOME ?? "", ".codex");

/** `model` and `model_reasoning_effort` from the owner's own config.toml (top-level lines only), so a hub session keeps the owner's model. */
function carriedCodexKeys(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.startsWith("[")) break;
    const m = /^(model|model_reasoning_effort)\s*=\s*"([^"\\]*)"\s*$/.exec(line);
    if (m) out[m[1] as string] = m[2] as string;
  }
  return out;
}

/**
 * Writes the session's CODEX_HOME (P49 S10): config.toml, rules/hub.rules, skills/ (links to the core skills) and auth.json (a link to the
 * owner's, never a copy). Returns the folder.
 */
export function writeCodexHome(o: { paths: HubPaths; projectsDir: string; slug: string | undefined; unattended: boolean; instructions: string; env?: NodeJS.ProcessEnv }): string {
  const env = o.env ?? process.env;
  const home = codexHome(o.paths, o.slug);
  mkdirSync(path.join(home, "rules"), { recursive: true });
  const owner = ownerCodexHome(env);
  const toml = codexConfigToml({ paths: o.paths, projectsDir: o.projectsDir, slug: o.slug, unattended: o.unattended, servers: instanceMcpServers(o.paths, o.slug), instructions: o.instructions, carry: carriedCodexKeys(path.join(owner, "config.toml")) });
  writeFileSync(path.join(home, "config.toml"), toml);
  writeFileSync(path.join(home, "rules", "hub.rules"), codexRules());
  const auth = path.join(home, "auth.json");
  rmSync(auth, { force: true });
  if (existsSync(path.join(owner, "auth.json"))) symlinkSync(path.join(owner, "auth.json"), auth);
  const skills = path.join(home, "skills");
  rmSync(skills, { recursive: true, force: true });
  mkdirSync(skills, { recursive: true });
  if (existsSync(o.paths.skills)) {
    for (const e of readdirSync(o.paths.skills, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(path.join(o.paths.skills, e.name, "SKILL.md"))) symlinkSync(path.join(o.paths.skills, e.name), path.join(skills, e.name));
    }
  }
  return home;
}

// ---- sticky binding (S5) ----
const bindingFile = (root: string) => path.join(stateDir(root), "binding.json");

export function readBinding(root: string): string | undefined {
  try {
    const j = JSON.parse(readFileSync(bindingFile(root), "utf8")) as { project?: unknown };
    return typeof j.project === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(j.project) ? j.project : undefined;
  } catch { return undefined; }
}
export function writeBinding(root: string, project: string | undefined): void {
  if (!project) { rmSync(bindingFile(root), { force: true }); return; }
  mkdirSync(stateDir(root), { recursive: true });
  writeFileSync(bindingFile(root), JSON.stringify({ project, at: new Date().toISOString() }) + "\n");
}

/** What a session may be bound to. `continue`/`pick` keep the stored binding; an env binding is never changed to another project. */
export function resolveBinding(o: { mode: "continue" | "new" | "pick"; requested?: string; stored?: string; envProject?: string }): { project?: string; sticky: boolean } {
  const env = o.envProject?.trim() || undefined;
  if (env && o.requested && env !== o.requested) {
    throw new Error(`this shell already belongs to project "${env}" (HUB_PROJECT); refusing "${o.requested}". Open a new terminal and run \`hub agent ${o.requested}\`.`);
  }
  if (o.requested) return { project: o.requested, sticky: false };
  if (o.mode === "new") return env ? { project: env, sticky: true } : { sticky: false };
  const project = env ?? o.stored;
  return project ? { project, sticky: true } : { sticky: false };
}

// ---- the PreToolUse guard (S3) ----
/** The guarded folders as the audit must recognise them: the instance's projects folder and database, relative to the instance and absolute. */
export function auditLayout(paths: HubPaths): AuditLayout {
  const rel = (p: string) => path.relative(paths.home, p).split(path.sep).join("/");
  const both = (p: string) => [...(rel(p).startsWith("..") ? [] : [rel(p)]), p];
  return { projects: both(paths.projects), db: both(paths.db) };
}

export interface GuardInput { tool_name?: unknown; tool_input?: unknown; session_id?: unknown; agent_id?: unknown }
export interface GuardResult { violations: string[]; block: boolean }

/** The hub's own skills (folders of the core's `skills/` with a SKILL.md) and the ones the project's kind allows; none for an unknown kind. */
export function skillScope(kindId: string, dir: string): SkillScope | undefined {
  const kind = kindOf(kindId);
  if (!kind) return undefined;
  const hub = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, "SKILL.md"))).map((e) => e.name) : [];
  return { allowed: kind.skills, hub };
}

export function guardDecision(payload: GuardInput, o: { slug?: string; accounts: readonly string[]; mode: string; skills?: SkillScope | undefined; layout: AuditLayout }): GuardResult {
  const call: ToolCall = { name: String(payload.tool_name ?? ""), input: payload.tool_input };
  // Unbound session (project-setup, `hub agent new`): no project to compare with, but sends and secrets still count.
  const violations = auditToolCalls([call], o.slug ?? "(unbound)", o.accounts, o.skills, o.layout).filter((v) => o.slug || !/outside project|in a \(unbound\)|touched \S+\/\S+ in a/.test(v));
  return { violations, block: violations.length > 0 && o.mode === "block" };
}

/** `root` is the instance root (state, ledger, log); `paths` (default: the instance at `root`) say where the skills ship. */
export interface GuardEnv { root: string; projectsDir?: string; env?: NodeJS.ProcessEnv; paths?: HubPaths }

/** `hub guard`: tool call JSON on stdin; exit 0 (allow) or 2 (block, reason on stderr). Warn mode logs to state/guard.log and allows. Never throws. */
export function runGuard(stdin: string, g: GuardEnv): { code: 0 | 2; stderr: string } {
  const env = g.env ?? process.env;
  const mode = env.HUB_GUARD === "block" ? "block" : "warn";
  let payload: GuardInput;
  try { payload = JSON.parse(stdin) as GuardInput; } catch { return { code: 0, stderr: "" }; }
  const slug = env.HUB_PROJECT?.trim() || undefined;
  const paths = g.paths ?? pathsAt(g.root, env);
  let accounts: string[] = [];
  let skills: SkillScope | undefined;
  if (slug) {
    try {
      const cfg = loadProject(g.projectsDir ?? defaultProjectsRoot(), slug).parsed.config;
      accounts = [...cfg.mail.accounts];
      skills = skillScope(cfg.kind, paths.skills);
    }
    catch { return mode === "block" ? { code: 2, stderr: `hub guard: project "${slug}" cannot be loaded; blocked` } : { code: 0, stderr: "" }; }
  }
  const r = guardDecision(payload, { slug, accounts, mode, skills, layout: auditLayout(paths) });
  // P28 B3: before a reply is drafted, this session must have read the client's thread and profile, and the reply must not copy an earlier one.
  if (slug) r.violations.push(...preDraftViolations(payload, g.root, slug));
  r.block = r.violations.length > 0 && mode === "block";
  if (!r.violations.length) return { code: 0, stderr: "" };
  const text = `hub guard (${mode}): ${r.violations.join("; ")}`;
  try {
    const logFile = paths.guardLog;
    mkdirSync(path.dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${new Date().toISOString()} ${mode} ${slug ?? "-"} ${text}\n`);
  } catch { /* a log that cannot be written must not stop the session */ }
  return r.block ? { code: 2, stderr: text } : { code: 0, stderr: text };
}

/** The pre-draft rule (research 15 section 3.2): only `create_reply` is judged, against the ledger of this session and subagent. Never throws. */
export function preDraftViolations(payload: GuardInput, root: string, slug: string): string[] {
  try {
    if (!String(payload.tool_name ?? "").endsWith("__create_reply")) return [];
    const sid = typeof payload.session_id === "string" ? payload.session_id : "";
    if (!sid) return [];
    const aid = typeof payload.agent_id === "string" && payload.agent_id ? payload.agent_id : undefined;
    return preDraftCheck(readSession(root, slug, sid), { name: String(payload.tool_name), input: payload.tool_input }, aid ? { aid } : {}).violations;
  } catch { return []; }
}

/** `hub guard --post`: the PostToolUse hook. Appends the call's thin summary to the session's ledger (from the ORIGINAL reply), then for `get_message_content` prints a replacement reply with slim headers. Always exit 0. */
export function runGuardPost(stdin: string, g: GuardEnv): { code: 0; stderr: string; stdout?: string } {
  let stdout: string | undefined;
  try {
    const payload = JSON.parse(stdin) as PostPayload;
    const slug = (g.env ?? process.env).HUB_PROJECT?.trim();
    if (slug) recordPost(g.root, slug, payload);
    if (String(payload.tool_name ?? "").endsWith("__get_message_content")) {
      const slim = slimMessageContent(payload.tool_response);
      if (slim != null) stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: slim } });
    }
  } catch { /* the ledger must never stop a session */ }
  return { code: 0, stderr: "", ...(stdout ? { stdout } : {}) };
}
