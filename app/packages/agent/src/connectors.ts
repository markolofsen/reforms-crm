import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentCli, HubPaths } from "@hub/config/paths";
import type { ProjectConfig } from "@hub/projects/model";
import { CLAUDE_CHROME_SERVER } from "./claude";
import { notionCapability, type NotionScope } from "./notion-scope";

// P62: connectors, the Google services a project's sessions may reach beside mail-mcp and Notion. A connector is a Google-hosted
// MCP server (`calendarmcp.googleapis.com`, `drivemcp.googleapis.com`) under a hub name, one Google account each: `gcal-<label>`,
// `gdrive-<label>`, an entry of the instance's MCP config (`hub connectors add`). A project attaches it by name in project.md
// (`calendar.connector`, `drive.connector`), from any Google account (owner, 2026-11-19: no binding to the mailboxes). A session
// gets exactly its project's connectors, never another's, and only the tools on the kind's allowlist: every other published tool
// is denied by exact name, and the guard refuses any call off the list (`connector-guard.ts`). Claude Code only: Google's servers
// need a pre-registered OAuth client, and Codex 0.146 has no way to give it one (C0).

export const CONNECTOR_KINDS = ["calendar", "drive"] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export interface KindDef {
  /** The hub name's prefix: `gcal-<label>`. */
  prefix: string;
  /** The service as the owner says it. */
  label: string;
  /** Google's endpoint (C0, read 2026-11-20). */
  url: string;
  /** Every tool name known for the service: Google's published list plus the claude.ai connector's extra names (a belt). */
  tools: readonly string[];
  /** The tools a session may call. Everything else of `tools` is denied by name; anything unknown, by the guard. */
  allowed: readonly string[];
  /** Allowed writes, each held to the guard's rule (calendar: a hold with no guests). */
  holds: readonly string[];
  /** The module a project's kind must have (a support kind has no calendar). */
  module: "calendar" | null;
}

export const KINDS: Readonly<Record<ConnectorKind, KindDef>> = {
  calendar: {
    prefix: "gcal",
    label: "Calendar",
    url: "https://calendarmcp.googleapis.com/mcp/v1",
    tools: ["list_calendars", "list_events", "get_event", "search_events", "suggest_time", "create_event", "update_event", "delete_event", "respond_to_event"],
    allowed: ["list_calendars", "list_events", "get_event", "search_events", "suggest_time", "create_event", "update_event"],
    holds: ["create_event", "update_event"],
    module: "calendar",
  },
  drive: {
    prefix: "gdrive",
    label: "Drive",
    url: "https://drivemcp.googleapis.com/mcp/v1",
    tools: [
      "search_files", "list_recent_files", "get_file_metadata", "read_file_content", "download_file_content", "get_file_permissions", "copy_file", "create_file",
      "list_file_revisions", "list_shared_drives", "get_shared_drive_metadata", "share_file", "trash_file", "update_file", "create_shared_drive", "update_shared_drive",
    ],
    allowed: ["search_files", "list_recent_files", "get_file_metadata", "read_file_content", "download_file_content", "get_file_permissions", "list_file_revisions", "list_shared_drives", "get_shared_drive_metadata"],
    holds: [],
    module: null,
  },
};

const NAME = /^(gcal|gdrive)-[a-z0-9][a-z0-9-]*$/;

/** The kind a hub connector name says, or null for any other server name. */
export function connectorKindOf(name: string): ConnectorKind | null {
  const m = NAME.exec(name);
  if (!m) return null;
  return (CONNECTOR_KINDS.find((k) => KINDS[k].prefix === m[1]) ?? null);
}

type Spec = Record<string, unknown>;
const readServers = (f: string): Record<string, Spec> => {
  try { return ((JSON.parse(readFileSync(f, "utf8")) as { mcpServers?: Record<string, Spec> }).mcpServers ?? {}); } catch { return {}; }
};

/** The MCP file a session's servers come from: `.mcp.json`, else `config/mcp.json`, else the core's defaults (as `instanceMcpServers`). */
export const mcpSourceOf = (paths: HubPaths): string | undefined => [paths.mcpFile, path.join(paths.configDir, "mcp.json"), paths.mcpDefaults].find((f) => existsSync(f));

export interface InstanceConnector { name: string; kind: ConnectorKind; spec: Spec; /** The spec names the kind's Google endpoint over HTTP. */ endpointOk: boolean }

/** Every connector the instance's MCP config names (`gcal-*`, `gdrive-*`), attached or not. */
export function instanceConnectors(paths: HubPaths): InstanceConnector[] {
  const src = mcpSourceOf(paths);
  const servers = src ? readServers(src) : {};
  return Object.entries(servers).flatMap(([name, spec]) => {
    const kind = connectorKindOf(name);
    return kind ? [{ name, kind, spec, endpointOk: spec.type === "http" && spec.url === KINDS[kind].url }] : [];
  });
}

// ---- the account each connector is signed in to (`state/connectors.json`) ----

export interface ConnectorAccount { account: string; /** `stated`: the owner said it (`hub connectors add --account`); `session`: a session read it (`list_calendars`). */ how: "stated" | "session"; at: string }
type StateFile = { schema: 1; connectors: Record<string, ConnectorAccount> };

export function readConnectorAccounts(paths: HubPaths): Record<string, ConnectorAccount> {
  try {
    const j = JSON.parse(readFileSync(paths.connectors, "utf8")) as StateFile;
    return j.schema === 1 && j.connectors && typeof j.connectors === "object" ? j.connectors : {};
  } catch { return {}; }
}

/** Records the account of one connector (atomic write). A session's read replaces a stated one; nothing else is kept. */
export function writeConnectorAccount(paths: HubPaths, name: string, account: string, how: ConnectorAccount["how"], at: Date = new Date()): void {
  const all = readConnectorAccounts(paths);
  all[name] = { account: account.trim().toLowerCase(), how, at: at.toISOString() };
  mkdirSync(path.dirname(paths.connectors), { recursive: true });
  const tmp = `${paths.connectors}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ schema: 1, connectors: all } satisfies StateFile, null, 2) + "\n");
  renameSync(tmp, paths.connectors);
}

// ---- which connectors a project's session gets ----

export interface AttachedConnector { name: string; kind: ConnectorKind; spec: Spec; account: ConnectorAccount | null }
export interface ConnectorProblem { name: string; kind: ConnectorKind; why: string }

type ConnectorFields = Pick<ProjectConfig, "calendar" | "drive" | "modules">;

/** The connectors project.md lists, resolved against the instance's MCP config: what a Claude session gets, and what is wrong with the rest. */
export function resolveConnectors(paths: HubPaths, cfg: ConnectorFields): { attached: AttachedConnector[]; problems: ConnectorProblem[] } {
  const known = new Map(instanceConnectors(paths).map((c) => [c.name, c]));
  const accounts = readConnectorAccounts(paths);
  const attached: AttachedConnector[] = [];
  const problems: ConnectorProblem[] = [];
  const lists: Array<[ConnectorKind, readonly string[]]> = [["calendar", cfg.calendar.connector], ["drive", cfg.drive.connector]];
  for (const [kind, names] of lists) {
    for (const name of new Set(names)) {
      const c = known.get(name);
      const mod = KINDS[kind].module;
      if (mod && !cfg.modules.includes(mod)) problems.push({ name, kind, why: `this project's kind has no ${mod} module` });
      else if (!c) problems.push({ name, kind, why: "not in the instance's MCP config" });
      else if (c.kind !== kind) problems.push({ name, kind, why: `a ${KINDS[c.kind].label} connector listed as ${KINDS[kind].label}` });
      else if (!c.endpointOk) problems.push({ name, kind, why: `its entry is not Google's ${KINDS[kind].label} endpoint (${KINDS[kind].url})` });
      else attached.push({ name, kind, spec: c.spec, account: accounts[name] ?? null });
    }
  }
  return { attached, problems };
}

/** `mcp__<name>__<tool>` for every known tool of the attached connectors that is not on the kind's allowlist: Claude's deny rules and `--disallowedTools`. */
export const connectorDeniedTools = (attached: readonly Pick<AttachedConnector, "name" | "kind">[]): string[] =>
  attached.flatMap((c) => KINDS[c.kind].tools.filter((t) => !KINDS[c.kind].allowed.includes(t)).map((t) => `mcp__${c.name}__${t}`));

/**
 * The browser part of the capabilities line (decision 0040 as amended 2026-11-20; owner 2026-11-26: use it, actively): the Hub
 * ships no browser; the agent studies sites in the owner's own Chrome, linked to its CLI, and it is never a send path. Claude Code
 * names its tools (`--chrome` adds `claude-in-chrome`); Codex's extension tools are not named (not read from a Codex session).
 */
export function browserCapability(cli: AgentCli): string {
  const tools = cli === "claude" ? `Claude in Chrome (\`mcp__${CLAUDE_CHROME_SERVER}__*\`; if they are deferred, load them in one ToolSearch call)` : "your CLI's own Chrome extension tools (load them first if they are not loaded yet)";
  return `browser: the owner's own browser, as he set it up (his Chrome, linked to this CLI and signed in as him; the Hub adds none): use it by default to study any site, ours, a client's or a competitor's, above all when a plain fetch is blocked, empty, needs JavaScript or his sign-in, through ${tools}, in a new tab for an outside site and in his tab when he points at a page; if the extension is not connected, say so and fall back to fetch. Never submit a lead form; mail and messenger messages go only through the hub's drafts and its send door, never through the browser`;
}

/**
 * The capabilities line of a bound session (K4), appended after the project's identity: what this session can reach, built from
 * the same resolver that writes its MCP file, so it never names a tool the session lacks. Rules: `@docs/core/26-capabilities.md`.
 * P82: with the project's Notion scope, the notion part names its databases by id (one source with the guard, `notion-scope.ts`).
 * P140 K3: an owner's session also reads and edits the knowledge entry files, so "use only what it names" does not forbid them.
 */
export function sessionCapabilities(slug: string, attached: readonly AttachedConnector[], cli: AgentCli, notion?: NotionScope): string {
  const who = (c: AttachedConnector) => `${c.name} (${c.account ? c.account.account : "account not confirmed yet"})`;
  const cal = attached.filter((c) => c.kind === "calendar");
  const drive = attached.filter((c) => c.kind === "drive");
  const parts = ["mail: mail-mcp (read only) and the hub's draft_write (unsent drafts)", notion ? notionCapability(notion) : "notion: the project's CRM databases", "knowledge: the hub's knowledge_search and knowledge_get, and the entry files directly"];
  if (cli === "codex") {
    if (cal.length || drive.length) parts.push(`calendar and drive: not in Codex sessions (${[...cal, ...drive].map((c) => c.name).join(", ")} sign in only in Claude Code)`);
    else parts.push("calendar: none attached", "drive: none attached");
  } else {
    parts.push(cal.length ? `calendar: ${cal.map(who).join(", ")}, read, and holds with no guests on the first (skill calendar)` : "calendar: none attached (Apple Calendar is not reachable from a hub session)");
    parts.push(drive.length ? `drive: ${drive.map(who).join(", ")}, search, read and link onto the client's Notion profile only; never share, copy, create or trash` : "drive: none attached");
  }
  parts.push(browserCapability(cli)); // decision 0040 as amended: his browser, the Hub's send door
  return `Project ${slug}'s capabilities (generated from project.md and the instance's connectors; how to use them: @docs/core/26-capabilities.md): ${parts.join("; ")}. A service listed as none is not reachable here: say so, never look for another way.`;
}
