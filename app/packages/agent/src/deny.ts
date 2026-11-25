import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { dropFolder, pathsAt, SHELL_DROPS, type HubPaths } from "@hub/config/paths";
import { NOTION_DENIED, NOTION_PREFIX } from "@hub/projects/notion-tools";

// What a hub agent session may never do, in both CLIs (plan p17, P49 S10). These match tool names and command text, so
// they are a belt, not the boundary: a decimal IP or a script defeats a text rule. The OS sandbox is the boundary
// (`session.ts`); these stay on beside it.

/** P147 E1: the CLI's built-in multi-agent Workflow tool, denied in every Hub agent session. */
export const WORKFLOW_TOOL = "Workflow";

/**
 * Tools that send, forward, delete or cancel. Denied outright: drafts only, nothing is ever sent or removed. mail-mcp's
 * `create_reply` too (P52, decision 0030): it pastes through a compose window that needs Mail in front and leaves an empty
 * reply when the owner's browser is; drafts are written by the hub MCP server's `draft_write`. The Notion part is
 * `NOTION_DENIED` of `@hub/projects/notion-tools`.
 */
export const DENIED_TOOLS: readonly string[] = [
  "mcp__mail-mcp__create_reply",
  "mcp__mail-mcp__create_outgoing_message",
  "mcp__mail-mcp__replace_outgoing_message",
  "mcp__mail-mcp__replace_reply",
  "mcp__mail-mcp__delete_outgoing_message",
  "mcp__mail-mcp__delete_draft",
  ...NOTION_DENIED.map((d) => `${NOTION_PREFIX}${d.tool}`),
  // P147 E1 (decision 0055 point 8): no self-made fan-out in a Hub session, dock or background. On 2026-11-25 a dock session
  // ran 68 agents of its own for "process the leads"; bulk lead work is the server's pass, one lead per turn.
  WORKFLOW_TOOL,
];

/** mail-mcp's read tools, the only ones a skill may name (decision 0030: mail-mcp is read only for the agent). */
export const MAIL_MCP_READ_TOOLS: readonly string[] = ["list_accounts", "list_mailboxes", "find_messages", "get_message_content", "list_drafts", "list_outgoing_messages"];

/**
 * Decision 0046: the one send tool an ATTENDED session (one the owner started) has: `hub`'s `messenger_send`, one messenger draft
 * on the owner's word, verified and sent by the server through the owner's send door. A background run never has it.
 */
export const ATTENDED_SEND_TOOLS: readonly string[] = ["mcp__hub__messenger_send"];

/** Who started the session: the owner (the dock, a terminal, a resumed session: attended) or the Hub (a background run). */
export type SessionRun = "owner" | "background";

/**
 * The denied tools of a run: {@link DENIED_TOOLS} always, and for a background run also {@link ATTENDED_SEND_TOOLS}
 * (decision 0046 point 3: a background run never sends). Default background: the stricter list.
 * Every list in this file binds the MODEL's processes (the CLI, its shell and its MCP servers), never the server: the send door
 * (`@hub/messengers/door`) reads no session mode, so a server-side sender (decision 0048's autopilot, P139) is not reached by
 * them; it still passes every stage of that door. The autopilot turn's own model process denies every hub tool but its five
 * (`autopilotDisallowed`, `./autopilot/session.ts`).
 */
export const deniedTools = (run: SessionRun = "background"): readonly string[] => (run === "background" ? [...DENIED_TOOLS, ...ATTENDED_SEND_TOOLS] : DENIED_TOOLS);

/** `mcp__<server>__<tool>` split back into the server's own tool names (Codex's `disabled_tools` takes these), for a run. */
export function deniedToolsOf(server: string, run: SessionRun = "background"): string[] {
  const pre = `mcp__${server}__`;
  return deniedTools(run).filter((t) => t.startsWith(pre)).map((t) => t.slice(pre.length));
}

/** A tool name that looks like it sends, forwards or removes: the Agent tools check fails when one is not denied (P49 5B). */
// The hub's own `mail_junk` (P147 3m item 1, 3n) moves one inbound message to Mail's Junk or Trash and is exempt by design, not
// by a lucky name: the owner asked for it, both are recoverable in Mail (never a deletion), the server does the move (the agent's
// shell has no Mail scripting) and refuses a known sender (a Clients card, a mail we sent, a lead), and only the sessions the
// owner starts carry it (deny-modes pins it out of every background and pass profile).
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
 * the core's server (`hub mcp`, P51: the admin's focus, the read-only views, the knowledge tools since P129 A4, the draft
 * writer), always registered.
 */
export const HUB_MCP_SERVERS = ["mail-mcp", "notion", "hub"] as const;

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

/**
 * Deny rules for an owner's Claude session (settings.json): secrets, the live database, other projects' session files,
 * mail-sending programs. P140 K3 (owner 2026-11-24, `skills/README.md` "Reading and writing files"): the session reads and edits
 * `projects/**`, other projects included (the client guard is "never quote another brand's or project's fact", not the path);
 * it reads the database folder and the other tabs' drops but never edits them (the live DB is the server's, a tab's files are
 * that tab's). Still denied both ways: secrets, and the other projects' session files and Codex homes (they hold that
 * project's capability, P112 S3). The protected paths (core, config, the send policy, `state/autopilot.json`, `.claude`, `.git`,
 * `run.sh`, `CLAUDE.md`, the log) are Edit-denied in every mode by `protectedEditRules` of `claude.ts`.
 */
export function denyRules(projectsDir: string, root: string, slug: string | undefined, paths: HubPaths = pathsAt(root)): string[] {
  const rel = (p: string) => (path.relative(root, p) || ".").split(path.sep).join("/");
  const rules: string[] = [];
  const both = [`./${rel(paths.secrets)}/**`];
  const editOnly: string[] = [];
  editOnly.push(`./${rel(path.dirname(paths.db))}/**`);
  // P112 S3: another project's session files (its MCP config holds its project capability) and Codex home, beside its folder.
  for (const o of otherProjects(projectsDir, slug)) {
    both.push(`./${rel(path.join(paths.stateProjects, o))}/**`, `./${rel(path.join(paths.codexHomes, o))}/**`);
  }
  // P76: a file dropped on another project's tab, or on a Shell tab, is that tab's only (read, never changed).
  for (const d of otherDrops(paths, projectsDir, slug)) editOnly.push(`./${rel(d)}/**`);
  for (const p of both) for (const tool of ["Read", "Edit"]) rules.push(`${tool}(${p})`);
  for (const p of editOnly) rules.push(`Edit(${p})`);
  // `hub send` is the hub's own sender (decision 0011, plan P23): a person runs it, never the agent.
  rules.push("Bash(osascript *)", "Bash(*state/secrets*)", "Bash(sendmail *)", "Bash(mail *)", ...HUB_SEND_COMMANDS, ...HUB_SEQUENCE_OWNER_COMMANDS, ...HUB_MAIL_OWNER_COMMANDS, ...HUB_CONNECTOR_OWNER_COMMANDS, ...HUB_OPEN_COMMANDS, ...HUB_API_COMMANDS, ...deniedTools("owner"));
  return rules;
}
