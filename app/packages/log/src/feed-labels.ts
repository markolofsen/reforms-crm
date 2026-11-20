// The one label table of the agent activity feed (P59, plan table 4c). A label is a verb and at most one id: never a
// command, a query, an address, a subject or a path. Only `labelOfTool` reads a tool's input or output, and only for the
// one id field it names (`draft_show.id`, `draft_write.draft`, `record-draft`'s `draftId`) and the `ok` of a record.

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
const HUB_LABELS: Record<string, string> = { mcp__hub__drafts_list: "lists drafts", mcp__hub__client_show: "reads a client", mcp__hub__messenger_history: "reads a chat", mcp__hub__messenger_draft_write: "writes a messenger draft" };

/** The command texts of a shell call: Claude's `command`, Codex's `cmd` or `command` as a string or an argv (`["bash", "-lc", "..."]`, each part tested). */
function commandsOf(input: unknown): string[] {
  if (typeof input === "string") return [input];
  const o = obj(input);
  const c = o?.command ?? o?.cmd;
  return typeof c === "string" ? [c] : Array.isArray(c) ? c.map(String) : [];
}

/** `hub record-draft` run as a command (also at the end of a pipe: `echo '{...}' | hub record-draft --project x`); `--help` is not a record. */
const RECORD_DRAFT = /(?:^|[|;&(]\s*)(?:\S*\/)?hub\s+record-draft\b/;
export const isRecordDraft = (command: string): boolean => RECORD_DRAFT.test(command) && !/--help\b/.test(command);

/** `record-draft`'s own JSON reply inside the logged excerpt (escaped once when it sits in a `stdout` string). */
function recordReply(output: unknown): { ok: boolean; draft: number | null } {
  const t = textOf(output);
  const ok = /\\*"ok\\*"\s*:\s*true/.test(t);
  const m = /\\*"draftId\\*"\s*:\s*(\d{1,9})/.exec(t);
  return { ok, draft: ok && m?.[1] ? Number(m[1]) : null };
}

function recordLabel(output: unknown, done: boolean): Labelled {
  const r = recordReply(output);
  return { label: r.draft ? `records draft ${r.draft}` : "records a draft", draft: r.draft, ready: done && r.ok };
}

/** The first number after `key:` in a Codex script's text (`tools.mcp__hub__draft_show({id: 3})`). */
function scriptId(code: string, key: string): number | null {
  const m = new RegExp(`\\b${key}\\s*:\\s*(\\d{1,9})\\b`).exec(code);
  return m?.[1] ? Number(m[1]) : null;
}

const notionWrite = /(create|update|append|move|delete|duplicate|comment|insert|restore)/i;

/**
 * The label of one tool call, or null when it is hidden. `output` is the paired result's logged output (undefined while it
 * runs); `done` says the call finished without an error, so a draft written or recorded counts as ready.
 */
export function labelOfTool(tool: string, input: unknown, output: unknown, done: boolean, via: readonly string[] = []): Labelled | null {
  const plain = (label: string): Labelled => ({ label, draft: null, ready: false });
  if (HIDDEN_TOOLS.has(tool)) return null;
  const inp = obj(input);
  if (tool === "mcp__hub__draft_show") {
    const id = idOf(inp?.id);
    return { label: id ? `reads draft ${id}` : "reads a draft", draft: id, ready: false };
  }
  if (tool === "mcp__hub__draft_write") {
    const id = idOf(inp?.draft);
    return { label: id ? `writes draft ${id}` : "writes a new draft", draft: id, ready: done };
  }
  const hub = HUB_LABELS[tool];
  if (hub) return plain(hub);
  if (tool.startsWith(MAIL)) return plain(MAIL_LABELS[tool.slice(MAIL.length)] ?? tool);
  if (tool.startsWith("mcp__knowledge-mcp__")) return plain("reads the knowledge base");
  const [, server = "", ...action] = tool.split("__");
  if (tool.startsWith("mcp__") && /notion/i.test(server)) return plain(notionWrite.test(action.join("__")) ? "updates Notion" : "reads Notion");
  if (COMMAND_TOOLS.has(tool)) return commandsOf(input).some(isRecordDraft) ? recordLabel(output, done) : plain("runs a command");
  if (READ_TOOLS.has(tool)) return plain("reads a file");
  if (EDIT_TOOLS.has(tool)) return plain("edits a file");
  if (WEB_TOOLS.has(tool)) return plain("looks something up on the web");
  if (tool === "exec") return execLabel(input, output, done, via);
  return plain(tool);
}

/**
 * Codex code mode (`exec`): the label of the first tool its script names that is not hidden, with its id when the script's
 * text was kept (a script that names a mail-body tool or the draft writer is a hash, so it gives no id). A script that names
 * only hidden tools is hidden; one that names none runs a script, or records a draft.
 */
function execLabel(input: unknown, output: unknown, done: boolean, via: readonly string[]): Labelled | null {
  const code = typeof input === "string" ? input : "";
  if (via.length) {
    const first = via.find((t) => !HIDDEN_TOOLS.has(t));
    if (!first) return null;
    const arg = first === "mcp__hub__draft_show" ? { id: scriptId(code, "id") } : first === "mcp__hub__draft_write" ? { draft: scriptId(code, "draft") } : {};
    return labelOfTool(first, arg, output, done);
  }
  if (isRecordDraft(code)) return recordLabel(output, done);
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
