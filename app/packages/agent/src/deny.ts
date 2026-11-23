import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { dropFolder, pathsAt, SHELL_DROPS, type HubPaths } from "@hub/config/paths";
import { NOTION_DENIED, NOTION_PREFIX } from "@hub/projects/notion-denied";

// What a hub agent session may never do, in both CLIs (plan p17, P49 S10). These match tool names and command text, so
// they are a belt, not the boundary: a decimal IP or a script defeats a text rule. In unattended mode the OS sandbox is
// the boundary (`session.ts`); these stay on in every mode.

/**
 * Tools that send, forward, delete or cancel. Denied outright: drafts only, nothing is ever sent or removed. mail-mcp's
 * `create_reply` too (P52, decision 0030): it pastes through a compose window that needs Mail in front and leaves an empty
 * reply when the owner's browser is; drafts are written by the hub MCP server's `draft_write`. The Notion part is
 * `NOTION_DENIED` of `@hub/projects/notion-denied`.
 */
export const DENIED_TOOLS: readonly string[] = [
  "mcp__mail-mcp__create_reply",
  "mcp__mail-mcp__create_outgoing_message",
  "mcp__mail-mcp__replace_outgoing_message",
  "mcp__mail-mcp__replace_reply",
  "mcp__mail-mcp__delete_outgoing_message",
  "mcp__mail-mcp__delete_draft",
  ...NOTION_DENIED.map((d) => `${NOTION_PREFIX}${d.tool}`),
];

/** mail-mcp's read tools, the only ones a skill may name (decision 0030: mail-mcp is read only for the agent). */
export const MAIL_MCP_READ_TOOLS: readonly string[] = ["list_accounts", "list_mailboxes", "find_messages", "get_message_content", "list_drafts", "list_outgoing_messages"];

/**
 * P129 verdict 12: the hosted Notion tools the skills call, plus the owner-request set among them (fetch, search, query,
 * create pages, update page). P112 S3 enforces it (default-deny); until then the skill lint keeps the skills inside it.
 */
export const NOTION_ALLOWED: readonly string[] = [
  "notion-search",
  "notion-fetch",
  "notion-query-data-sources",
  "notion-create-pages",
  "notion-update-page",
  "notion-get-teams",
  "notion-create-database",
  "notion-create-view",
  "notion-update-data-source",
  "notion-update-view",
];

/**
 * Decision 0046: the one send tool an ATTENDED session has: `hub`'s `messenger_send`, one messenger draft on the owner's word,
 * verified and sent by the server through the owner's send door. The Agent tools check passes it only in attended mode.
 */
export const ATTENDED_SEND_TOOLS: readonly string[] = ["mcp__hub__messenger_send"];

/**
 * The denied tools of a mode: {@link DENIED_TOOLS} in every mode, and in an unattended one also {@link ATTENDED_SEND_TOOLS}
 * (decision 0046 point 3: background and unattended sessions never send). Default unattended: the stricter list.
 */
export const deniedTools = (unattended = true): readonly string[] => (unattended ? [...DENIED_TOOLS, ...ATTENDED_SEND_TOOLS] : DENIED_TOOLS);

/** `mcp__<server>__<tool>` split back into the server's own tool names (Codex's `disabled_tools` takes these), for a mode. */
export function deniedToolsOf(server: string, unattended = true): string[] {
  const pre = `mcp__${server}__`;
  return deniedTools(unattended).filter((t) => t.startsWith(pre)).map((t) => t.slice(pre.length));
}

/** A tool name that looks like it sends, forwards or removes: the Agent tools check fails when one is not denied (P49 5B). */
export const SEND_LIKE_TOOL = /send|forward|reply|outgoing|delete|trash|move|cancel/i;
/** Tool names that match {@link SEND_LIKE_TOOL} but only write an unsent draft or read: never denied. */
export const DRAFT_TOOLS: readonly string[] = ["list_outgoing_messages", "notion-calendar-list-events"];

/** Bash patterns of the hub's sender: spelled as `hub send`, `./run.sh send`, `hub.sh send`, `hub.mjs send`, or the CLI source. */
export const HUB_SEND_COMMANDS: readonly string[] = ["Bash(*hub send*)", "Bash(*run.sh send*)", "Bash(*hub.sh send*)", "Bash(*hub.mjs send*)", "Bash(*hub.mjs\" send*)", "Bash(*installer/src/cli.ts send*)"];

/**
 * Follow-ups (P47, D1 of P48): a session may `hub sequences enrol --phrase "<the owner's words>"` (the CLI refuses it without, and the
 * guard flags it); declining a silence (`enrol --not-now`) and restarting (`pause`, `resume`) stay the owner's, denied in every spelling.
 */
export const HUB_SEQUENCE_OWNER_COMMANDS: readonly string[] = ["Bash(*sequences enrol*--not-now*)", "Bash(*sequences pause*)", "Bash(*sequences resume*)"];

/**
 * Moving Mail drafts to Trash (`hub drafts sweep --apply`, P56) is the owner's: a session may list them (the dry run),
 * never move them.
 */
export const HUB_MAIL_OWNER_COMMANDS: readonly string[] = ["Bash(*drafts sweep*--apply*)"];

/**
 * Connectors (P62): adding one and stating its account are the owner's (`hub connectors add|account`); a session may list them.
 */
export const HUB_CONNECTOR_OWNER_COMMANDS: readonly string[] = ["Bash(*connectors add*)", "Bash(*connectors account*)"];

/**
 * Opening things on the owner's screen (P61) is his: `hub open` in every spelling and a bare `open` (Finder, Mail and any
 * app would take his screen), and the desktop handoff (P61 9c H7: an agent must never move itself out of its own guards).
 */
export const HUB_OPEN_COMMANDS: readonly string[] = ["Bash(open *)", "Bash(/usr/bin/open *)", "Bash(*hub open*)", "Bash(*run.sh open*)", "Bash(*hub.sh open*)", "Bash(*hub.mjs open*)", "Bash(*hub.mjs\" open*)", "Bash(*installer/src/cli.ts open*)", "Bash(*claude --desktop*)", "Bash(*codex app)", "Bash(*codex app *)"];

/**
 * The admin server's Send is a loopback HTTP route (P23 S3). Text rules on loopback names: a second belt only, since
 * `curl http://2130706433:<port>` is the same address (research 21 section 5, test 4). The sandbox blocks it.
 */
export const HUB_API_COMMANDS: readonly string[] = ["Bash(*127.0.0.1*)", "Bash(*localhost*)", "Bash(*[::1]*)", "Bash(*0.0.0.0*)", "WebFetch(domain:localhost)", "WebFetch(domain:127.0.0.1)", "WebFetch(domain:[::1])"];

/**
 * The hub's own MCP servers: everything else is dropped (Claude `--strict-mcp-config`, Codex its own `CODEX_HOME`). `hub` is
 * the core's read-only server (`hub mcp`, P51: the admin's focus and read-only views), always registered.
 */
export const HUB_MCP_SERVERS = ["mail-mcp", "notion", "knowledge-mcp", "hub"] as const;

/**
 * Command prefixes Codex refuses without asking (`prefix_rule(..., decision="forbidden")`): the same doors as the
 * Bash patterns above, as argv prefixes. A second belt beside the sandbox.
 */
export const CODEX_FORBIDDEN_PREFIXES: ReadonlyArray<readonly string[]> = [
  ["hub", "send"], ["./run.sh", "send"], ["run.sh", "send"], ["./hub.sh", "send"], ["hub.sh", "send"],
  ["hub", "sequences", "pause"], ["hub", "sequences", "resume"], ["./run.sh", "sequences", "pause"], ["./run.sh", "sequences", "resume"],
  ["hub", "drafts", "sweep", "--apply"], ["./run.sh", "drafts", "sweep", "--apply"],
  ["hub", "connectors", "add"], ["./run.sh", "connectors", "add"], ["hub", "connectors", "account"], ["./run.sh", "connectors", "account"],
  ["osascript"], ["sendmail"], ["mail"],
  ["open"], ["/usr/bin/open"], ["hub", "open"], ["./run.sh", "open"], ["run.sh", "open"], ["./hub.sh", "open"], ["hub.sh", "open"],
  ["claude", "--desktop"], ["codex", "app"],
];

/** Slugs of the projects a session could be bound to (folders with no `_` or `.` prefix), other than `slug`. */
export function otherProjects(projectsDir: string, slug: string | undefined): string[] {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".") && e.name !== slug)
    .map((e) => e.name)
    .sort();
}

/** P76: the drop folders a session bound to `slug` may not read: every other project's and the Shell's (`state/drops/<x>`). */
export const otherDrops = (paths: Pick<HubPaths, "drops">, projectsDir: string, slug: string | undefined): string[] =>
  [...otherProjects(projectsDir, slug), SHELL_DROPS].map((o) => dropFolder(paths, o));

/** Deny rules for Claude's settings.json: secrets, the live database, other projects' folders, mail-sending programs. */
export function denyRules(projectsDir: string, root: string, slug: string | undefined, paths: HubPaths = pathsAt(root), unattended = true): string[] {
  const rel = (p: string) => (path.relative(root, p) || ".").split(path.sep).join("/");
  const rules: string[] = [];
  const denied = [`./${rel(paths.secrets)}/**`, `./${rel(path.dirname(paths.db))}/**`];
  for (const o of otherProjects(projectsDir, slug)) denied.push(`./${rel(path.join(projectsDir, o))}/**`);
  // P76: a file dropped on another project's tab, or on a Shell tab, is that tab's only.
  for (const d of otherDrops(paths, projectsDir, slug)) denied.push(`./${rel(d)}/**`);
  for (const p of denied) for (const tool of ["Read", "Edit"]) rules.push(`${tool}(${p})`);
  // `hub send` is the hub's own sender (decision 0011, plan P23): a person runs it, never the agent.
  rules.push("Bash(osascript *)", "Bash(*state/secrets*)", "Bash(sendmail *)", "Bash(mail *)", ...HUB_SEND_COMMANDS, ...HUB_SEQUENCE_OWNER_COMMANDS, ...HUB_MAIL_OWNER_COMMANDS, ...HUB_CONNECTOR_OWNER_COMMANDS, ...HUB_OPEN_COMMANDS, ...HUB_API_COMMANDS, ...deniedTools(unattended));
  return rules;
}
