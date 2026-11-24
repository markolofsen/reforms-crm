/**
 * What a hub session may call of the hosted Notion MCP (P129 A0, P131 verdict 6, P112 S3): default-deny. {@link NOTION_ALLOWED}
 * is the whole of what passes; every other Notion tool is refused in every mode, warn included, by the guard hook
 * (`apps/installer/src/safety.ts`) and named by `hub audit` (`./audit.ts`). {@link NOTION_DENIED} keeps the known dangerous ones
 * with why, for the static belts that can only name tools: Claude's deny rules and `--disallowedTools`, Codex's
 * `disabled_tools` (`@hub/agent/deny`). It lives here, not in `@hub/agent`, because `@hub/projects` cannot import the agent
 * package and the agent package imports this one.
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

/**
 * P129 verdict 12, P112 S3: the hosted Notion tools a session may call: the ones the skills call, plus the owner-request set
 * among them (fetch, search, query, create pages, update page). Everything else is refused; the skill lint keeps the skills
 * inside it. A new Notion tool is added here, by a person, with the skill that needs it.
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

export const NOTION_PREFIX = "mcp__notion__";

/**
 * Why a Notion tool is refused, or null when it may be called (it is on {@link NOTION_ALLOWED}, or it is not a Notion tool):
 * the named reason of {@link NOTION_DENIED}, else the default-deny sentence.
 */
export function notionDenial(name: string): string | null {
  if (!name.startsWith(NOTION_PREFIX)) return null;
  const tool = name.slice(NOTION_PREFIX.length);
  const d = NOTION_DENIED.find((e) => e.tool === tool);
  if (d) return `${d.tool} is denied in every mode: ${d.why}`;
  return NOTION_ALLOWED.includes(tool) ? null : `${tool} is not on the Notion allow-list, so it is denied in every mode (P112 S3: unknown Notion tools fail closed)`;
}
