/**
 * The hosted Notion MCP's tools a hub session may never call, with why: one declarative list (P129 A0, P131 verdict 6).
 * Claude's deny rules and `--disallowedTools`, Codex's `disabled_tools` (`@hub/agent/deny`), the guard hook (refused in
 * every mode, warn included: `apps/installer/src/safety.ts`) and `hub audit` (`./audit.ts`) all read it. It lives here, not in
 * `@hub/agent`, because `@hub/projects` cannot import the agent package and the agent package imports this one. P112 S3
 * later turns Notion to an allow-list here.
 */
export const NOTION_DENIED: ReadonlyArray<{ readonly tool: string; readonly why: string }> = [
  { tool: "notion-delete-pages", why: "it deletes pages" },
  { tool: "notion-delete-databases", why: "it deletes databases" },
  { tool: "notion-delete-comment", why: "it deletes a comment" },
  { tool: "notion-move-pages", why: "it moves pages out of the project's databases" },
  { tool: "notion-calendar-cancel-events", why: "it cancels events and mails their attendees" },
  // Creating or updating an event can invite its attendees by mail.
  { tool: "notion-calendar-create-events", why: "an event can invite its attendees by mail" },
  { tool: "notion-calendar-update-events", why: "an event can invite its attendees by mail" },
  // They start or message a Notion agent, which then acts outside this session's rules.
  { tool: "notion-send-message-to-session", why: "it messages a Notion agent, which acts outside this session's rules" },
  { tool: "notion-spawn-session", why: "it starts a Notion agent, which acts outside this session's rules" },
];

export const NOTION_PREFIX = "mcp__notion__";

/** Why a Notion tool is refused (from {@link NOTION_DENIED}), or null when the list does not name it. */
export function notionDenial(name: string): string | null {
  if (!name.startsWith(NOTION_PREFIX)) return null;
  const d = NOTION_DENIED.find((e) => e.tool === name.slice(NOTION_PREFIX.length));
  return d ? `${d.tool} is denied in every mode: ${d.why}` : null;
}
