// P133 (P131 verdict 6): every Notion write a session makes is a line of its session log with the page ids it touched, so
// `hub log` names what the agent changed in the CRM. The one definition of "a Notion write" (the activity feed's label reads it too).

/** The verbs of a hosted Notion tool that change the workspace. */
export const NOTION_WRITE = /(create|update|append|move|delete|duplicate|comment|insert|restore)/i;

const NOTION_ID = /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi;
const MAX_IDS = 5;

/** A Notion tool's server and action (`mcp__notion__notion-update-page` → `notion`, `notion-update-page`), else null. */
export function notionTool(tool: string): { server: string; action: string } | null {
  const [head, server = "", ...action] = tool.split("__");
  return head === "mcp" && /notion/i.test(server) ? { server, action: action.join("__") } : null;
}

/**
 * The write a Notion tool call makes: its action and the ids its input names (pages, databases, data sources, parents),
 * dashes dropped, at most five, in the order they appear. Null for a read or any other tool.
 */
export function notionWriteOf(tool: string, input: unknown): { action: string; ids: string[] } | null {
  const t = notionTool(tool);
  if (!t || !NOTION_WRITE.test(t.action)) return null;
  const text = typeof input === "string" ? input : (JSON.stringify(input) ?? "");
  const ids = [...new Set([...text.matchAll(NOTION_ID)].map((m) => m[0].replace(/-/g, "").toLowerCase()))].slice(0, MAX_IDS);
  return { action: t.action, ids };
}
