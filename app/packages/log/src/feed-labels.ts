// The one label table of the agent activity feed (P59, plan table 4c). A label is a verb and at most one id: never a
// command, a query, an address, a subject or a path. Only `labelOfTool` reads a tool's input or output, and only for the
// one id field it names (`draft_show.draft` and `draft_write.draft`, P83, and the hub draft id `draft_write` recorded, P129 A3).

import { NOTION_WRITE, notionTool } from "./notion-writes";

export interface Labelled {
  label: string;
  /** The hub draft the call names, so the row links to its card. */
  draft: number | null;
  /** The call wrote and recorded a draft (verdict 8: the "ready" tone, once per turn). */
  ready: boolean;
}

/** Counted, never shown: they were 14 of 25 tool events in the saas file of 2026-11-19. */
export const HIDDEN_TOOLS: ReadonlySet<string> = new Set(["ToolSearch", "mcp__hub__focus"]);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : null);
const idOf = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : null);
/** A logged output as text: an excerpt string, or the JSON of a hashed body (which then holds no id or `ok`). */
const textOf = (v: unknown): string => (typeof v === "string" ? v : "");

const COMMAND_TOOLS: ReadonlySet<string> = new Set(["Bash", "shell", "exec_command", "local_shell", "unified_exec"]);
const READ_TOOLS: ReadonlySet<string> = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"]);
const WEB_TOOLS: ReadonlySet<string> = new Set(["WebFetch", "WebSearch", "web_search"]);
const MAIL = "mcp__mail-mcp__";
const MAIL_LABELS: Record<string, string> = {
  get_message_content: "reads a message",
  find_messages: "searches mail",
  list_accounts: "looks at mail accounts",
  list_mailboxes: "looks at mail accounts",
};
// P129 A4: the hub's read tools as renamed (project_show, mail_list, message_show) and the knowledge tools, which are the hub's now.
const HUB_LABELS: Record<string, string> = { mcp__hub__client_record: "records a client", mcp__hub__client_map: "redraws a client's map", mcp__hub__maps_due: "lists the maps due a redraw", mcp__hub__mail_list: "lists mail", mcp__hub__client_show: "reads a client", mcp__hub__message_show: "reads a client's message", mcp__hub__project_show: "reads the project's settings", mcp__hub__knowledge_search: "reads the knowledge base", mcp__hub__knowledge_get: "reads the knowledge base", mcp__hub__messenger_history: "reads a chat", mcp__hub__messenger_draft_write: "writes a messenger draft", mcp__hub__highlight: "points at your screen", mcp__hub__conversation_done: "marks a conversation no reply needed", mcp__hub__client_create: "creates a client", mcp__hub__chat_link: "links a chat to a client" };

/** P129 A3: the hub draft a `draft_write` reply or new thread recorded, from its logged result (`"record":{"draftId":7`). */
function recordedDraft(output: unknown): number | null {
  const m = /\\*"record\\*"\s*:\s*\{\\*"draftId\\*"\s*:\s*(\d{1,9})/.exec(textOf(output));
  return m?.[1] ? Number(m[1]) : null;
}

/** The first number after `key:` in a Codex script's text (`tools.mcp__hub__draft_show({draft: 3})`). */
function scriptId(code: string, key: string): number | null {
  const m = new RegExp(`\\b${key}\\s*:\\s*(\\d{1,9})\\b`).exec(code);
  return m?.[1] ? Number(m[1]) : null;
}

/**
 * The label of one tool call, or null when it is hidden. `output` is the paired result's logged output (undefined while it
 * runs); `done` says the call finished without an error, so a draft written or recorded counts as ready.
 */
export function labelOfTool(tool: string, input: unknown, output: unknown, done: boolean, via: readonly string[] = []): Labelled | null {
  const plain = (label: string): Labelled => ({ label, draft: null, ready: false });
  if (HIDDEN_TOOLS.has(tool)) return null;
  const inp = obj(input);
  if (tool === "mcp__hub__draft_show") {
    const id = idOf(inp?.draft);
    return { label: id ? `reads draft ${id}` : "reads a draft", draft: id, ready: false };
  }
  if (tool === "mcp__hub__draft_write") {
    const id = idOf(inp?.draft) ?? recordedDraft(output);
    return { label: id ? `writes draft ${id}` : "writes a new draft", draft: id, ready: done };
  }
  const hub = HUB_LABELS[tool];
  if (hub) return plain(hub);
  if (tool.startsWith(MAIL)) return plain(MAIL_LABELS[tool.slice(MAIL.length)] ?? tool);
  const notion = notionTool(tool);
  if (notion) return plain(NOTION_WRITE.test(notion.action) ? "updates Notion" : "reads Notion");
  if (COMMAND_TOOLS.has(tool)) return plain("runs a command");
  if (READ_TOOLS.has(tool)) return plain("reads a file");
  if (EDIT_TOOLS.has(tool)) return plain("edits a file");
  if (WEB_TOOLS.has(tool)) return plain("looks something up on the web");
  if (tool === "exec") return execLabel(input, output, done, via);
  return plain(tool);
}

/**
 * Codex code mode (`exec`): the label of the first tool its script names that is not hidden, with its id when the script's
 * text was kept (a script that names a mail-body tool or the draft writer is a hash, so it gives no id). A script that names
 * only hidden tools is hidden; one that names none runs a script.
 */
function execLabel(input: unknown, output: unknown, done: boolean, via: readonly string[]): Labelled | null {
  const code = typeof input === "string" ? input : "";
  if (via.length) {
    const first = via.find((t) => !HIDDEN_TOOLS.has(t));
    if (!first) return null;
    const arg = first === "mcp__hub__draft_show" || first === "mcp__hub__draft_write" ? { draft: scriptId(code, "draft") } : {};
    return labelOfTool(first, arg, output, done);
  }
  return { label: "runs a script", draft: null, ready: false };
}

/** What a wait on the owner says (`asked`), and whether it asks for him (the attention tone). `idle_prompt` does not: the turn already sounded. */
export const ASKED_LABELS: Record<string, { label: string; attention: boolean }> = {
  permission_prompt: { label: "waits for your permission", attention: true },
  permission_request: { label: "waits for your permission", attention: true },
  elicitation_dialog: { label: "waits for your answer", attention: true },
  elicitation_url_dialog: { label: "waits for your answer", attention: true },
  agent_needs_input: { label: "waits for your answer", attention: true },
  idle_prompt: { label: "waiting for you", attention: false },
};
