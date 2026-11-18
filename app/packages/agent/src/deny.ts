import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathsAt, type HubPaths } from "@hub/config/paths";

// What a hub agent session may never do, in both CLIs (plan p17, P49 S10). These match tool names and command text, so
// they are a belt, not the boundary: a decimal IP or a script defeats a text rule. In unattended mode the OS sandbox is
// the boundary (`session.ts`); these stay on in every mode.

/**
 * Tools that send, forward, delete or cancel. Denied outright: drafts only, nothing is ever sent or removed. mail-mcp's
 * `create_reply` too (P52, decision 0030): it pastes through a compose window that needs Mail in front and leaves an empty
 * reply when the owner's browser is; drafts are written by the hub MCP server's `draft_write`.
 */
export const DENIED_TOOLS: readonly string[] = [
  "mcp__mail-mcp__create_reply",
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

/** `mcp__<server>__<tool>` split back into the server's own tool names (Codex's `disabled_tools` takes these). */
export function deniedToolsOf(server: string): string[] {
  const pre = `mcp__${server}__`;
  return DENIED_TOOLS.filter((t) => t.startsWith(pre)).map((t) => t.slice(pre.length));
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
  ["osascript"], ["sendmail"], ["mail"],
];

/** Slugs of the projects a session could be bound to (folders with no `_` or `.` prefix), other than `slug`. */
export function otherProjects(projectsDir: string, slug: string | undefined): string[] {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".") && e.name !== slug)
    .map((e) => e.name)
    .sort();
}

/** Deny rules for Claude's settings.json: secrets, the live database, other projects' folders, mail-sending programs. */
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
