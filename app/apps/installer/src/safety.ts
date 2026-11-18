import { slimMessageContent } from "./slim-headers";
import { pathsAt, type HubPaths } from "@hub/config/paths";
import { auditToolCalls, defaultProjectsRoot, type AuditLayout, kindOf, loadProject, preDraftCheck, type SkillScope, type ToolCall } from "@hub/projects";
import { instanceServer } from "./mcp-servers";
import { readSession, recordPost, type PostPayload } from "./evidence-store";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Tool-level safety of `hub agent` (plan p17). Evidence that these hold under --dangerously-skip-permissions: the plan, S1.
// Three layers: (1) --disallowedTools + generated deny rules (hard), (2) --strict-mcp-config with the hub's own servers
// (no account connectors), (3) the PreToolUse guard `hub guard` (warn by default, HUB_GUARD=block to refuse).

/** Tools that send, forward, delete or cancel. Denied outright: drafts only, nothing is ever sent or removed. */
export const DENIED_TOOLS: readonly string[] = [
  "mcp__mail-mcp__create_outgoing_message",
  "mcp__mail-mcp__replace_outgoing_message",
  "mcp__mail-mcp__replace_reply",
  "mcp__mail-mcp__delete_outgoing_message",
  "mcp__mail-mcp__delete_draft",
  "mcp__notion__notion-delete-pages",
  "mcp__notion__notion-delete-databases",
  "mcp__notion__notion-delete-comment",
  "mcp__notion__notion-move-pages",
  "mcp__notion__notion-calendar-cancel-events",
  // the claude.ai Gmail connector, should one ever be loaded (strict MCP config normally keeps it out)
  ...["send_message", "forward", "reply", "trash_message", "trash_thread", "delete_draft"].map((t) => `mcp__claude_ai_Gmail__${t}`),
];

/** Bash patterns of the hub's sender: spelled as `hub send`, `./run.sh send`, `hub.sh send`, `hub.mjs send`, or the CLI source. */
export const HUB_SEND_COMMANDS: readonly string[] = ["Bash(*hub send*)", "Bash(*run.sh send*)", "Bash(*hub.sh send*)", "Bash(*hub.mjs send*)", "Bash(*hub.mjs\" send*)", "Bash(*installer/src/cli.ts send*)"];

/**
 * Follow-ups (P47, D1 of P48): a session may `hub sequences enrol --phrase "<the owner's words>"` (the CLI refuses it without, and the
 * guard flags it); declining a silence (`enrol --not-now`) and restarting (`pause`, `resume`) stay the owner's, denied in every spelling
 * (the `*` before the subcommand covers `hub`, `run.sh`, `hub.sh`, `hub.mjs` and the CLI source). Stop, delay and judge only reduce mail.
 */
export const HUB_SEQUENCE_OWNER_COMMANDS: readonly string[] = ["Bash(*sequences enrol*--not-now*)", "Bash(*sequences pause*)", "Bash(*sequences resume*)"];

/**
 * The admin server's Send is a loopback HTTP route (P23 S3). The route cannot tell a person's click from an agent's
 * `curl`, so the agent's session never reaches loopback: no Bash command that names it, no WebFetch to it.
 */
export const HUB_API_COMMANDS: readonly string[] = ["Bash(*127.0.0.1*)", "Bash(*localhost*)", "Bash(*[::1]*)", "Bash(*0.0.0.0*)", "WebFetch(domain:localhost)", "WebFetch(domain:127.0.0.1)", "WebFetch(domain:[::1])"];

/** The hub's own MCP servers: everything else is dropped by --strict-mcp-config. */
export const HUB_MCP_SERVERS = ["mail-mcp", "notion", "knowledge-mcp"] as const;

export const stateDir = (root: string) => pathsAt(root).stateProjects;
export const slugDir = (root: string, slug: string | undefined) => path.join(stateDir(root), slug ?? "_unbound");

/** Slugs of the projects a session could be bound to (folders with a project.md, no `_` prefix). */
function otherProjects(projectsDir: string, slug: string | undefined): string[] {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".") && e.name !== slug)
    .map((e) => e.name)
    .sort();
}

export interface SessionFiles { settings: string; mcp: string; disallowed: string[]; rules: string[] }

/** Deny rules for settings.json: secrets, the live database, other projects' folders, mail-sending programs. */
export function denyRules(projectsDir: string, root: string, slug: string | undefined, paths: HubPaths = pathsAt(root)): string[] {
  const rel = (p: string) => (path.relative(root, p) || ".").split(path.sep).join("/");
  const rules: string[] = [];
  const denied = [`./${rel(paths.secrets)}/**`, `./${rel(path.dirname(paths.db))}/**`];
  for (const o of otherProjects(projectsDir, slug)) denied.push(`./${rel(path.join(projectsDir, o))}/**`);
  for (const p of denied) for (const tool of ["Read", "Edit"]) rules.push(`${tool}(${p})`);
  // `hub send` is the hub's own sender (decision 0011, plan P23): a person runs it, never the agent.
  rules.push("Bash(osascript *)", "Bash(*state/secrets*)", "Bash(sendmail *)", "Bash(mail *)", ...HUB_SEND_COMMANDS, ...HUB_SEQUENCE_OWNER_COMMANDS, ...HUB_API_COMMANDS, ...DENIED_TOOLS);
  return rules;
}

/** Writes state/projects/<slug|_unbound>/{settings.json,mcp.json} (git-ignored: state/*) and returns what to pass to claude. */
export function writeSessionFiles(root: string, projectsDir: string, slug: string | undefined, nodeBin = process.execPath, paths: HubPaths = pathsAt(root)): SessionFiles {
  const dir = slugDir(root, slug);
  mkdirSync(dir, { recursive: true });
  const rules = denyRules(projectsDir, root, slug, paths);
  const hub = paths.hubBin;
  const settings = {
    permissions: { deny: rules },
    hooks: {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${JSON.stringify(nodeBin)} ${JSON.stringify(hub)} guard`, timeout: 20 }] }],
      // P28 B3: the evidence ledger (what was read before each reply). Fires inside subagents too (S1), keyed by session_id and agent_id.
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${JSON.stringify(nodeBin)} ${JSON.stringify(hub)} guard --post`, timeout: 20 }] }],
    },
  };
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");

  const src = [paths.mcpFile, path.join(paths.configDir, "mcp.json"), paths.mcpDefaults].find((f) => existsSync(f));
  const all = src ? ((JSON.parse(readFileSync(src, "utf8")) as { mcpServers?: Record<string, Record<string, unknown>> }).mcpServers ?? {}) : {};
  const servers: Record<string, Record<string, unknown>> = {};
  for (const name of HUB_MCP_SERVERS) {
    if (!all[name]) continue;
    const s = instanceServer(all[name], paths);
    if (name === "knowledge-mcp" && slug) s.env = { ...(s.env as object), HUB_PROJECT: slug };
    servers[name] = s;
  }
  const mcpFile = path.join(dir, "mcp.json");
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: servers }, null, 2) + "\n");
  return { settings: settingsFile, mcp: mcpFile, disallowed: [...DENIED_TOOLS], rules };
}

/** Flags that enforce the files. `=` forms: the variadic flags would otherwise swallow the next argument. */
export function enforcementArgs(f: SessionFiles): string[] {
  return ["--settings", f.settings, "--strict-mcp-config", `--mcp-config=${f.mcp}`, `--disallowedTools=${f.disallowed.join(",")}`];
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
