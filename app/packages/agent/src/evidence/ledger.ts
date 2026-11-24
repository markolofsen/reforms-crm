import { chatEntry, HUB_MESSENGER_HISTORY } from "./chat-ledger";

// The session ledger (P28 B3, narrowed by P140 K2): one thin line per tool call the guard needs later in the same session. Two
// kinds only: a Notion read or create (P82: where a page came from, for the guard's update rule) and a `messenger_history` read
// (P71 M2: the chats a messenger reply may be written from). No mail body, no Notion text, no message. What a Mail draft was
// based on is not recorded and not judged (owner, 2026-11-24: the agent follows the workflow). The PostToolUse hook
// (`hub guard --post`) appends; the PreToolUse guard reads.

export interface LedgerEntry {
  ts?: string;
  sid?: string;
  /** Subagent id; absent for the main session. */
  aid?: string;
  /** Short tool name, e.g. `notion-fetch`. */
  tool: string;
  /** `chat`: a `messenger_history` read (P71 M2), judged only by `chatDraftViolations`. */
  kind: "notion" | "chat";
  // notion
  op?: "fetch" | "query" | "search" | "update" | "create";
  emails?: string[];
  /** P82: the data sources the call named or (fetch) the result sits in, and the page ids its result returned, as 32 hex characters: where a page came from, for the guard's update rule. */
  sources?: string[];
  pageIds?: string[];
  editedAt?: string;
  // chat: the chats a messenger_history call returned, as `<channel>:<chat id>`
  chats?: string[];
  /** Internal Hub refs returned by messenger_history, used to bind a focused `chat:<id>` draft to its prior read. */
  chatRefs?: string[];
}

export interface CallRecord { name: string; input: unknown; result?: unknown }

const ADDRESS = /[^\s,;<>"'()\[\]]+@[^\s,;<>"'()\[\]]+/g;
const shortName = (n: string) => n.split("__").pop() ?? n;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const lower = (s: string) => s.trim().toLowerCase();

/** The text of a tool result: a string, an MCP content array, or a `tool_result` block's content. */
export function resultText(r: unknown): string {
  if (r == null) return "";
  if (typeof r === "string") return r;
  if (Array.isArray(r)) return r.map((b) => (typeof b === "string" ? b : typeof obj(b).text === "string" ? (obj(b).text as string) : JSON.stringify(b))).join("\n");
  const o = obj(r);
  if (Array.isArray(o.content)) return resultText(o.content);
  if (typeof o.text === "string") return o.text;
  return JSON.stringify(r);
}

/** One tool call as a ledger line, or null when the guard never needs it. */
export function summarizeCall(c: CallRecord): LedgerEntry | null {
  if (c.name === HUB_MESSENGER_HISTORY) return chatEntry(c);
  if (!c.name.startsWith("mcp__notion__")) return null;
  const tool = shortName(c.name);
  const op = ({ "notion-fetch": "fetch", "notion-query-data-sources": "query", "notion-search": "search", "notion-update-page": "update", "notion-create-pages": "create" } as const)[tool as "notion-fetch"];
  if (!op) return null;
  const emails = [...new Set((JSON.stringify(c.input ?? {}).match(ADDRESS) ?? []).map(lower))];
  const edited = resultText(c.result).match(/"?(?:last_edited_time|lastEditedTime|last_edited)"?\s*[:=]\s*"?(\d{4}-\d{2}-\d{2})/i)?.[1];
  return { tool, kind: "notion", op, ...(emails.length ? { emails } : {}), ...(edited ? { editedAt: edited } : {}), ...(c.result !== undefined ? notionOrigin(op, c.input, resultText(c.result)) : {}) };
}

/** The ledger line of a call in a session (or subagent `aid`), or null. */
export function entryFor(call: CallRecord, aid?: string): LedgerEntry | null {
  const e = summarizeCall(call);
  return e ? { ...e, ...(aid ? { aid } : {}) } : null;
}

const COLLECTION = /collection:\/\/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/gi;
const NOTION_ID = /(?<![0-9a-f])([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?![0-9a-f])/gi;
const hex = (v: string): string => v.replace(/-/g, "").toLowerCase();

/**
 * P82: where a Notion read or create came from. A query names its data sources; a create its parent data source; a fetch's
 * result names the data source its object sits in. The page ids are every id its result returned (at most 300). Search is not
 * an origin: what it finds may be any teamspace's.
 */
function notionOrigin(op: string, input: unknown, text: string): Pick<LedgerEntry, "sources" | "pageIds"> {
  if (op !== "query" && op !== "fetch" && op !== "create") return {};
  const inText = JSON.stringify(input ?? {});
  const parent = op === "create" ? str(obj(obj(input).parent).data_source_id) : undefined;
  const from = op === "fetch" ? text : inText;
  const sources = [...new Set([...[...from.matchAll(COLLECTION)].map((m) => hex(m[1] ?? "")), ...(parent ? [hex(parent)] : [])])];
  const fetched = op === "fetch" ? [...inText.matchAll(NOTION_ID)].map((m) => hex(m[1] ?? "")) : [];
  const pageIds = [...new Set([...fetched, ...[...text.matchAll(NOTION_ID)].map((m) => hex(m[1] ?? ""))])].filter((x) => x.length === 32 && !sources.includes(x)).slice(0, 300);
  return { ...(sources.length ? { sources } : {}), ...(pageIds.length ? { pageIds } : {}) };
}
