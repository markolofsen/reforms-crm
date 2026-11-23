import { slimMessageContent } from "./slim-headers";
import { codexSessionPaths, instanceFeatures, pathsAt, type HubPaths } from "@hub/config/paths";
import { auditToolCalls, chatDraftViolations, HUB_MESSENGER_SEND, defaultProjectsRoot, HUB_MESSENGER_DRAFT_WRITE, type AuditLayout, isDraftWrite, kindOf, loadProject, preDraftCheck, type LedgerEntry, type SkillScope, type ToolCall } from "@hub/projects";
import { instanceServer } from "./mcp-servers";
import { claudeDisallowed, claudeSettings, type ClaudeFiles } from "@hub/agent/claude";
import { codexConfigToml, codexHome, codexRules } from "@hub/agent/codex";
import { HUB_MCP_SERVERS } from "@hub/agent/deny";
import { notionDenial } from "@hub/projects/notion-denied";
import { resolveConnectors, type AttachedConnector } from "@hub/agent/connectors";
import { connectorViolations, notionNote, notionScopeOf, notionViolations, recordConnectorRead, type ConnectorScope, type NotionRead } from "@hub/agent/connector-guard";
import { readSession, recordPost, type PostPayload } from "@hub/projects/evidence-store";
import { openDbReadOnly, readAgentSettings } from "@hub/db";
import type { AgentSettings } from "@hub/config";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parsePayload, toolCallEvents, toolResultEvent } from "@hub/log/hooks";
import { appendEvents, logStoreOf, readEvents } from "@hub/log/store";
import { ownerWordsFound } from "@hub/agent/owner-word";
import { OWNER_WORD_MAX_AGE_HOURS } from "@hub/config";

// Tool-level safety of `hub agent` (plans p17 and P49). What each CLI gets is built in `@hub/agent` (one source for the launcher,
// the doctor and the server); this file writes it. Layers: (1) deny rules and disallowed tools, (2) the hub's MCP servers only
// (Claude --strict-mcp-config, Codex its own CODEX_HOME), (3) the PreToolUse guard `hub guard` (warn by default, HUB_GUARD=block
// to refuse), (4) in unattended mode the OS sandbox (no network, no Apple Events, the policy and config read-only).

export const stateDir = (root: string) => pathsAt(root).stateProjects;
export const slugDir = (root: string, slug: string | undefined) => path.join(stateDir(root), slug ?? "_unbound");

/** `agent`: the project's model and advisor the files were written with (P55), for the launcher's env and rule line. */
export type SessionFiles = ClaudeFiles & { rules: string[]; agent: AgentSettings };

type McpFile = { mcpServers?: Record<string, Record<string, unknown>> };
const readMcp = (f: string): Record<string, Record<string, unknown>> => (existsSync(f) ? ((JSON.parse(readFileSync(f, "utf8")) as McpFile).mcpServers ?? {}) : {});

/**
 * The instance's MCP servers, made absolute for it: `.mcp.json`, else `config/mcp.json`, else the core's defaults. `hub` (P51) is the
 * core's own server: taken from the core's defaults when the instance file predates it, and started with the hub's own Node.
 */
export function instanceMcpServers(paths: HubPaths, slug: string | undefined, nodeBin: string = process.execPath, connectors: readonly AttachedConnector[] = []): Record<string, Record<string, unknown>> {
  const src = [paths.mcpFile, path.join(paths.configDir, "mcp.json"), paths.mcpDefaults].find((f) => existsSync(f));
  const all = src ? readMcp(src) : {};
  const core = readMcp(paths.mcpDefaults);
  const servers: Record<string, Record<string, unknown>> = {};
  for (const name of HUB_MCP_SERVERS) {
    const spec = all[name] ?? (name === "hub" ? core[name] : undefined);
    if (!spec) continue;
    const s = instanceServer(spec, paths);
    if (name === "hub" && slug) s.env = { ...(s.env as object), HUB_PROJECT: slug };
    if (name === "hub" && s.type === "stdio" && s.command === "node") s.command = nodeBin;
    servers[name] = s;
  }
  // P62: the project's own attached connectors (Claude Code only; the Codex home never gets them), never another project's.
  for (const c of connectors) servers[c.name] = structuredClone(c.spec);
  return servers;
}

/** P62: the connectors of a bound project (none for an unbound session or a project.md that does not load). */
export function projectConnectors(paths: HubPaths, projectsDir: string, slug: string | undefined): { attached: AttachedConnector[]; scope: ConnectorScope } {
  const none = { attached: [], scope: { attached: [], calendarId: null, driveFolders: [] } };
  if (!slug) return none;
  try {
    const cfg = loadProject(projectsDir, slug).parsed.config;
    const { attached } = resolveConnectors(paths, cfg);
    return { attached, scope: { attached, calendarId: cfg.calendar.id, driveFolders: cfg.drive.folder, notion: notionScopeOf(slug, cfg) } };
  } catch { return none; }
}

/**
 * Writes state/projects/<slug|_unbound>/{settings.json,mcp.json} (git-ignored: state/*) and returns what to pass to claude.
 * The model and advisor come from the project's row in the database (P55, Settings ▸ Agent), read at every start.
 */
export function writeSessionFiles(root: string, projectsDir: string, slug: string | undefined, nodeBin = process.execPath, paths: HubPaths = pathsAt(root), unattended = false): SessionFiles {
  const dir = slugDir(root, slug);
  mkdirSync(dir, { recursive: true });
  const agent = readAgentSettings(paths.db, slug);
  const { attached } = projectConnectors(paths, projectsDir, slug);
  const settings = claudeSettings({ paths, projectsDir, slug, nodeBin, unattended, agent, connectors: attached });
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  const mcpFile = path.join(dir, "mcp.json");
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: instanceMcpServers(paths, slug, nodeBin, attached) }, null, 2) + "\n");
  return { settings: settingsFile, mcp: mcpFile, disallowed: claudeDisallowed(attached, unattended), rules: (settings.permissions as { deny: string[] }).deny, agent };
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
export function writeCodexHome(o: { paths: HubPaths; projectsDir: string; slug: string | undefined; unattended: boolean; instructions: string; env?: NodeJS.ProcessEnv; nodeBin?: string }): string {
  const env = o.env ?? process.env;
  const home = codexHome(o.paths, o.slug);
  mkdirSync(path.join(home, "rules"), { recursive: true });
  const owner = ownerCodexHome(env);
  const toml = codexConfigToml({ paths: o.paths, projectsDir: o.projectsDir, slug: o.slug, unattended: o.unattended, servers: instanceMcpServers(o.paths, o.slug, o.nodeBin), instructions: o.instructions, nodeBin: o.nodeBin ?? process.execPath, carry: carriedCodexKeys(path.join(owner, "config.toml")) });
  writeFileSync(path.join(home, "config.toml"), toml);
  writeFileSync(path.join(home, "rules", "hub.rules"), codexRules());
  const auth = path.join(home, "auth.json");
  rmSync(auth, { force: true });
  if (existsSync(path.join(owner, "auth.json"))) symlinkSync(path.join(owner, "auth.json"), auth);
  const skills = codexSessionPaths(o.paths, o.slug).skills;
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
export function resolveBinding(o: { mode: "continue" | "new" | "pick" | "resume"; requested?: string; stored?: string; envProject?: string }): { project?: string; sticky: boolean } {
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
export interface GuardResult { violations: string[]; block: boolean; /** P62: a connector violation, which blocks whatever the mode. */ always?: true }

/** The hub's own skills (folders of the core's `skills/` with a SKILL.md) and the ones the project's kind allows; none for an unknown kind. */
export function skillScope(kindId: string, dir: string): SkillScope | undefined {
  const kind = kindOf(kindId);
  if (!kind) return undefined;
  const hub = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, "SKILL.md"))).map((e) => e.name) : [];
  return { allowed: kind.skills, hub };
}

export function guardDecision(payload: GuardInput, o: { slug?: string; accounts: readonly string[]; mode: string; skills?: SkillScope | undefined; layout: AuditLayout; connectors?: ConnectorScope; /** P82: this session's earlier Notion reads (the ledger). */ notionRead?: readonly NotionRead[]; /** Decision 0046: the instance's `agent.unattended` (default true: the stricter answer). */ unattended?: boolean }): GuardResult {
  const call: ToolCall = { name: String(payload.tool_name ?? ""), input: payload.tool_input };
  // Unbound session (project-setup, `hub agent new`): no project to compare with, but sends and secrets still count.
  // P129 A0, P131 verdict 6: a Notion tool of the one deny list is refused in every mode. The audit names it in the same
  // words (`@hub/projects/notion-denied`); here it moves from the mode-bound violations to the outward ones.
  const denied = notionDenial(call.name);
  // Decision 0046 point 3: an unattended session never sends, so `messenger_send` is refused there in every guard mode.
  const unattendedSend = call.name === HUB_MESSENGER_SEND && (o.unattended ?? true) ? `messenger_send is denied in an unattended session (decision 0046: the agent sends only in an attended one, on the owner's word)` : null;
  const violations = auditToolCalls([call], o.slug ?? "(unbound)", o.accounts, o.skills, o.layout, { unattended: o.unattended ?? true })
    .filter((v) => o.slug || !/outside project|in a \(unbound\)|touched \S+\/\S+ in a/.test(v))
    .filter((v) => v !== denied && v !== unattendedSend);
  // P62 K3: a connector call off its allowlist, or a hold with guests, is refused in every mode (it would leave the Mac).
  // P82: a Notion call on another project's database (or a page this session did not read from its own) is refused the same way.
  const outward = [...(denied ? [denied] : []), ...(unattendedSend ? [unattendedSend] : []), ...connectorViolations(call.name, call.input, o.connectors ?? { attached: [], calendarId: null, driveFolders: [] }), ...notionViolations(call.name, call.input, o.connectors?.notion, o.notionRead)];
  return { violations: [...violations, ...outward], block: outward.length > 0 || (violations.length > 0 && o.mode === "block"), ...(outward.length ? { always: true } : {}) };
}

/** `root` is the instance root (state, ledger, log); `paths` (default: the instance at `root`) say where the skills ship. */
export interface GuardEnv { root: string; projectsDir?: string; env?: NodeJS.ProcessEnv; paths?: HubPaths }

/** `hub guard`: tool call JSON on stdin; exit 0 (allow) or 2 (block, reason on stderr). Warn mode allows. Every call, and any violation, goes to the session log (P54). Never throws. */
export function runGuard(stdin: string, g: GuardEnv): { code: 0 | 2; stderr: string } {
  const env = g.env ?? process.env;
  const mode = env.HUB_GUARD === "block" ? "block" : "warn";
  let payload: GuardInput;
  try { payload = JSON.parse(stdin) as GuardInput; } catch { return { code: 0, stderr: "" }; }
  const slug = env.HUB_PROJECT?.trim() || undefined;
  const paths = g.paths ?? pathsAt(g.root, env);
  let accounts: string[] = [];
  let skills: SkillScope | undefined;
  const projectsDir = g.projectsDir ?? defaultProjectsRoot();
  if (slug) {
    try {
      const cfg = loadProject(projectsDir, slug).parsed.config;
      accounts = [...cfg.mail.accounts];
      skills = skillScope(cfg.kind, paths.skills);
    }
    catch { return mode === "block" ? { code: 2, stderr: `hub guard: project "${slug}" cannot be loaded; blocked` } : { code: 0, stderr: "" }; }
  }
  const sid = typeof payload.session_id === "string" ? payload.session_id : "";
  let notionRead: LedgerEntry[] = [];
  try { if (slug && sid && String(payload.tool_name ?? "").startsWith("mcp__notion__")) notionRead = readSession(g.root, slug, sid).filter((e) => e.kind === "notion"); } catch { /* the guard never throws: no ledger, no provenance */ }
  let unattended = true;
  try { unattended = instanceFeatures(paths).agent.unattended; } catch { /* unreadable config: the stricter answer */ }
  const r = guardDecision(payload, { slug, accounts, mode, skills, layout: auditLayout(paths), connectors: projectConnectors(paths, projectsDir, slug).scope, notionRead, unattended });
  // P28 B3: before a reply is drafted, this session must have read the client's thread and profile, and the reply must not copy an earlier one.
  if (slug) r.violations.push(...preDraftViolations(payload, g.root, slug, paths.db, paths));
  r.block = r.always === true || (r.violations.length > 0 && mode === "block");
  // P54: the call, and what the guard saw, go to the session log (the writer never throws).
  appendEvents(logStoreOf(paths), toolCallEvents(parsePayload(stdin) ?? {}, "claude", slug ?? null, { mode, violations: r.violations }));
  if (!r.violations.length) return { code: 0, stderr: "" };
  const text = `hub guard (${r.always ? "block" : mode}): ${r.violations.join("; ")}`;
  return r.block ? { code: 2, stderr: text } : { code: 0, stderr: text };
}

/** The pre-draft rule (research 15 section 3.2): only a draft write (`create_reply`, the hub's `draft_write`, and P71's `messenger_draft_write` by its own rule) is judged, against the ledger of this session and subagent. Never throws. */
export function preDraftViolations(payload: GuardInput, root: string, slug: string, db?: string, paths: HubPaths = pathsAt(root)): string[] {
  try {
    const name = String(payload.tool_name ?? "");
    const messenger = name === HUB_MESSENGER_DRAFT_WRITE;
    if (!isDraftWrite(name) && !messenger) return [];
    const sid = typeof payload.session_id === "string" ? payload.session_id : "";
    if (!sid) return [];
    // P129 verdict 7 (decision 0045 point 9): a Mail draft on the owner's own words (a poem, "переведи", a test to his address)
    // rests on them, not on the thread: when this project's session log holds them, the chain is not asked for.
    if (!messenger && ownerWordsVerified(payload.tool_input, slug, paths)) return [];
    const aid = typeof payload.agent_id === "string" && payload.agent_id ? payload.agent_id : undefined;
    // P71 M2: a messenger reply is judged by its own rule (its chat's history read first), never by the mail chain.
    if (messenger) return chatDraftViolations(readSession(root, slug, sid), { name, input: payload.tool_input }, aid);
    const replyFrom = revisionClient(payload.tool_input, slug, db);
    // P85b: a revision of a new thread answers no message either: what it was based on was judged at its first write.
    if (replyFrom === NEW_THREAD) return [];
    return preDraftCheck(readSession(root, slug, sid), { name: String(payload.tool_name), input: payload.tool_input }, { ...(aid ? { aid } : {}), ...(replyFrom ? { replyFrom } : {}) }).violations;
  } catch { return []; }
}

/** True when the draft write carries `owner_request` and this project's session log of the last 12 hours holds those words. */
export function ownerWordsVerified(input: unknown, slug: string, paths: HubPaths, now: Date = new Date()): boolean {
  const words = input && typeof input === "object" && "owner_request" in input ? input.owner_request : undefined;
  if (typeof words !== "string" || !words.trim()) return false;
  const since = new Date(now.getTime() - OWNER_WORD_MAX_AGE_HOURS * 3_600_000).toISOString();
  const events = readEvents(logStoreOf(paths), { project: slug, kinds: ["prompt"], since });
  return ownerWordsFound({ events, words, now }).ok;
}

/** `draft_write {draft}` (P53): the address of the client that hub draft of this project answers, so the read of their message counts as the target. */
const NEW_THREAD = "\u0000new-thread";
function revisionClient(input: unknown, slug: string, db: string | undefined): string | undefined {
  const id = input && typeof input === "object" ? (input as { draft?: unknown }).draft : undefined;
  if (typeof id !== "number" || !db || !existsSync(db)) return undefined;
  const h = openDbReadOnly(db);
  try {
    const row = h.db.$client.prepare("SELECT to_addr AS t, mail_ref AS r, context AS c FROM drafts WHERE id = ? AND project = ?").get(id, slug) as { t?: unknown; r?: unknown; c?: unknown } | undefined;
    if (row && row.r == null && typeof row.c === "string" && row.c.includes('"newThread":true')) return NEW_THREAD;
    return typeof row?.t === "string" ? row.t.match(/[^\s,;<>"']+@[^\s,;<>"']+/)?.[0] : undefined;
  } finally {
    h.close();
  }
}

/** `hub guard --post`: the PostToolUse hook. Appends the call's thin summary to the session's ledger and its result to the session log (both from the ORIGINAL reply), then for `get_message_content` prints a replacement reply with slim headers. Always exit 0. */
export function runGuardPost(stdin: string, g: GuardEnv): { code: 0; stderr: string; stdout?: string } {
  let stdout: string | undefined;
  try {
    const payload = JSON.parse(stdin) as PostPayload;
    const env = g.env ?? process.env;
    const slug = env.HUB_PROJECT?.trim();
    if (slug) recordPost(g.root, slug, payload);
    // P62: a session's list_calendars names the account its calendar connector is signed in to.
    if (slug && /^mcp__gcal-/.test(String(payload.tool_name ?? ""))) {
      const paths = g.paths ?? pathsAt(g.root, env);
      recordConnectorRead(paths, projectConnectors(paths, g.projectsDir ?? defaultProjectsRoot(), slug).attached, String(payload.tool_name), payload.tool_response);
    }
    const result = toolResultEvent(parsePayload(stdin) ?? {}, "claude", slug || null);
    if (result) appendEvents(logStoreOf(g.paths ?? pathsAt(g.root, env)), [result]);
    if (String(payload.tool_name ?? "").endsWith("__get_message_content")) {
      const slim = slimMessageContent(payload.tool_response);
      if (slim != null) stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: slim } });
    }
    // P82 (S0 point 3): a Notion search not narrowed to the project, or a fetch from another database, gets one note for the model.
    if (slug && /^mcp__notion__notion-(search|fetch)$/.test(String(payload.tool_name ?? ""))) {
      const note = notionNote(String(payload.tool_name), payload.tool_input, payload.tool_response, projectConnectors(g.paths ?? pathsAt(g.root, env), g.projectsDir ?? defaultProjectsRoot(), slug).scope.notion);
      if (note) stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note } });
    }
  } catch { /* the ledger must never stop a session */ }
  return { code: 0, stderr: "", ...(stdout ? { stdout } : {}) };
}
