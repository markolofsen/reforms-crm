import { chatEntry, HUB_MESSENGER_HISTORY } from "./chat-ledger";
import { fingerprint, judgeSimilarity, sim, type Verdict } from "./similarity";

// The observed witness of P28 (research 15 section 3.2). A ledger line is a thin summary of one tool call: which
// message was opened, who wrote it, which search ran, whether a Notion page was read, the sketch of a reply. No mail
// body, no Notion text. The same functions serve three callers, so one rule means one thing:
//   - the PreToolUse/PostToolUse hooks (`hub guard`, `hub guard --post`) that append and check live,
//   - `hub record-draft`, which cross-checks what the agent claims against the ledger,
//   - `hub audit-run`, which rebuilds the ledger from a finished transcript.
// mail-mcp ids are INTEGERS per mailbox (find_messages / get_message_content / create_reply), not Message-ID headers.
// The shape of the tool RESULTS is not verified against the real mail-mcp (S1 used a stub): parsing is tolerant and an
// unreadable result is "unknown", never a guess that favours the agent.

export interface LedgerEntry {
  ts?: string;
  sid?: string;
  /** Subagent id; absent for the main session. */
  aid?: string;
  /** Short tool name, e.g. `find_messages`. */
  tool: string;
  /** `chat`: a `messenger_history` read (P71 M2), judged only by `chatDraftViolations`, never as mail evidence. */
  kind: "find" | "read" | "draft" | "notion" | "knowledge" | "chat";
  account?: string;
  // find
  sender?: string;
  mailbox?: string;
  /** Ids the search returned; `null`: the result could not be read (unknown), `[]`: it said "nothing". */
  ids?: number[] | null;
  // read
  id?: number;
  from?: string;
  date?: string;
  bytes?: number;
  // draft (create_reply)
  replyTo?: number;
  /** A revision named by its hub draft id (P53): the client's address, so the read of their message is the target before Mail's id is known. */
  replyFrom?: string;
  fp?: number[];
  hash?: string;
  words?: number;
  /** The body has a money or date pattern, and whether it carries an `[Owner: ...]` placeholder. */
  figure?: boolean;
  placeholder?: boolean;
  /** `draft_write` only (P58/P60): the address the client wrote to and its brand, as the hub's writer resolved them from the inbound's headers. */
  wroteTo?: string;
  brand?: string;
  // notion
  op?: "fetch" | "query" | "search" | "update" | "create";
  emails?: string[];
  /** P82: the data sources the call named or (fetch) the result sits in, and the page ids its result returned, as 32 hex characters: where a page came from, for the guard's update rule. */
  sources?: string[];
  pageIds?: string[];
  editedAt?: string;
  // knowledge
  query?: string;
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

/** A tool result's JSON (the hub MCP answers one JSON object as text), or null. */
function parsedResult(r: unknown): unknown {
  if (r == null) return null;
  const structured = obj(r).structuredContent;
  if (structured) return structured;
  try {
    return JSON.parse(resultText(r));
  } catch {
    return null;
  }
}

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

const ID_KEYS = /"?(?:message_id|messageId|id)"?\s*[:=]\s*"?(\d+)/gi;

/** Ids in a find result; `null` when nothing in the text can be read as a list, `[]` when it clearly lists nothing. */
function findIds(text: string): number[] | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const j: unknown = JSON.parse(t);
    const list = Array.isArray(j) ? j : Array.isArray(obj(j).messages) ? (obj(j).messages as unknown[]) : Array.isArray(obj(j).results) ? (obj(j).results as unknown[]) : null;
    if (list) {
      const ids = list.map((m) => Number(obj(m).id ?? obj(m).message_id ?? obj(m).messageId)).filter((n) => Number.isInteger(n));
      return list.length === 0 ? [] : ids.length ? [...new Set(ids)] : null;
    }
  } catch { /* plain text: fall through */ }
  const ids = [...t.matchAll(ID_KEYS)].map((m) => Number(m[1]));
  if (ids.length) return [...new Set(ids)];
  return /\b(no|0|zero) (messages?|results?|matches)\b|^\[\s*\]$/i.test(t) ? [] : null;
}

/** The sender address in the text of one message, and its date, when the result says them. */
function fromOf(text: string): { from?: string; date?: string } {
  try { // a JSON reply names the fields; the regex below would also hit "from:" inside the raw headers' DKIM h= list
    const j = JSON.parse(text) as Record<string, unknown>;
    const m = (j.message && typeof j.message === "object" ? j.message : j) as Record<string, unknown>;
    const addr = String(m.sender ?? m.from ?? "").match(ADDRESS)?.[0];
    const d = m.dateReceived ?? m.date_received ?? m.date;
    if (addr || typeof d === "string") return { ...(addr ? { from: lower(addr) } : {}), ...(typeof d === "string" ? { date: d } : {}) };
  } catch { /* plain text: fall through */ }
  const head = text.slice(0, 4000);
  const f = head.match(/"?(?:from|sender)"?\s*[:=]\s*"?([^\n]*)/i)?.[1];
  const addr = f?.match(ADDRESS)?.[0];
  const date = head.match(/"?(?:date|dateReceived|date_received)"?\s*[:=]\s*"?([^\n",]+)/i)?.[1]?.trim();
  return { ...(addr ? { from: lower(addr) } : {}), ...(date ? { date } : {}) };
}

const FIGURE = /(?:[$€£¥]\s?\d|\d\s?(?:usd|eur|gbp|rub|rs|aed|%)\b|\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/i;

export interface SummarizeOptions {
  names?: readonly string[];
  signoff?: string;
  /** `draft_write {draft}` (P53): the address of the client that hub draft answers, looked up by the caller. */
  replyFrom?: string;
}

/** One tool call as a ledger line, or null when the call is not part of the evidence. */
export function summarizeCall(c: CallRecord, o: SummarizeOptions = {}): LedgerEntry | null {
  if (c.name === HUB_MESSENGER_HISTORY) return chatEntry(c);
  const tool = shortName(c.name);
  const i = obj(c.input);
  const account = str(i.account);
  // The hub's own draft writer (P52) takes mail-mcp's `create_reply` arguments: the same draft entry, judged the same way.
  // A revision names only the hub draft (P53): Mail's id of the answered message comes back in the result (`replyTo`).
  if (c.name === HUB_DRAFT_WRITE) {
    const r = obj(parsedResult(c.result));
    const e = draftEntry(tool, i.message_id === undefined ? { ...i, message_id: r.replyTo } : i, account, o);
    // P58: the result names it `clientWroteTo` (the address the client wrote to; never the From of the reply).
    return { ...e, ...(str(r.clientWroteTo) ? { wroteTo: lower(str(r.clientWroteTo)!) } : {}), ...(str(r.brand) ? { brand: str(r.brand)! } : {}) };
  }
  if (c.name.startsWith("mcp__mail-mcp__")) {
    if (tool === "find_messages") {
      const mb = Array.isArray(i.mailboxPath) ? (i.mailboxPath as unknown[]).join("/") : undefined;
      return { tool, kind: "find", ...(account ? { account } : {}), ...(str(i.sender) ? { sender: lower(str(i.sender)!) } : {}), ...(mb ? { mailbox: mb } : {}), ...(c.result !== undefined ? { ids: findIds(resultText(c.result)) } : {}) };
    }
    if (tool === "get_message_content") {
      const text = resultText(c.result);
      const id = Number(i.message_id);
      return { tool, kind: "read", ...(account ? { account } : {}), ...(Number.isInteger(id) ? { id } : {}), ...fromOf(text), bytes: text.length };
    }
    if (tool === "create_reply") return draftEntry(tool, i, account, o);
    return null;
  }
  if (c.name.startsWith("mcp__notion__")) {
    const op = ({ "notion-fetch": "fetch", "notion-query-data-sources": "query", "notion-search": "search", "notion-update-page": "update", "notion-create-pages": "create" } as const)[tool as "notion-fetch"];
    if (!op) return null;
    const emails = [...new Set((JSON.stringify(c.input ?? {}).match(ADDRESS) ?? []).map(lower))];
    const edited = resultText(c.result).match(/"?(?:last_edited_time|lastEditedTime|last_edited)"?\s*[:=]\s*"?(\d{4}-\d{2}-\d{2})/i)?.[1];
    return { tool, kind: "notion", op, ...(emails.length ? { emails } : {}), ...(edited ? { editedAt: edited } : {}), ...(c.result !== undefined ? notionOrigin(op, c.input, resultText(c.result)) : {}) };
  }
  if (c.name.startsWith("mcp__knowledge-mcp__") && (tool === "knowledge_search" || tool === "knowledge_get")) {
    return { tool, kind: "knowledge", ...(str(i.query) ? { query: str(i.query)!.slice(0, 200) } : {}) };
  }
  return null;
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

/** The hub MCP server's draft writer (P52): a draft like mail-mcp's `create_reply`. */
export const HUB_DRAFT_WRITE = "mcp__hub__draft_write";
/** True for a tool that writes a reply draft: mail-mcp's `create_reply` or the hub's `draft_write`. */
export const isDraftWrite = (name: string): boolean => name === HUB_DRAFT_WRITE || name.endsWith("__create_reply");

function draftEntry(tool: string, i: Record<string, unknown>, account: string | undefined, o: SummarizeOptions): LedgerEntry {
  const content = typeof i.content === "string" ? i.content : "";
  const id = Number(i.message_id);
  const fp = fingerprint(content, o);
  const words = content.split(/\s+/).filter(Boolean).length;
  return { tool, kind: "draft", ...(account ? { account } : {}), ...(Number.isInteger(id) ? { replyTo: id } : {}), ...(o.replyFrom ? { replyFrom: lower(o.replyFrom) } : {}), fp, hash: hashHex(content), words, figure: FIGURE.test(content), placeholder: /\[Owner:/i.test(content) };
}

function hashHex(s: string): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface Observation {
  /** Address of the client the reply goes to, when the read of the answered message said it. */
  client?: string;
  targetRead: boolean;
  /** Mail's id of the answered message as the read of it said (a revision's draft does not carry it before its result). */
  targetId?: number;
  historyFind: boolean;
  /** Messages the history search returned; null: unknown. */
  found: number | null;
  /** Distinct messages of this client opened. */
  read: number;
  readIds: number[];
  required: number;
  profile: boolean;
  facts: number;
  maxSim: number;
  similarTo: number | null;
  /** Index (in the entries) of the draft judged. */
  index: number;
  verdict: Verdict;
  /** Plain-language list of what is missing, in the order a-d of research 15. */
  missing: string[];
}

const same = (a: LedgerEntry, b: LedgerEntry) => (a.aid ?? "") === (b.aid ?? "");

/** What the session observed before the draft at `index` (an entry of kind `draft`). */
export function observeDraft(entries: readonly LedgerEntry[], index: number): Observation {
  const d = entries[index]!;
  const prev = (() => { for (let k = index - 1; k >= 0; k--) if (entries[k]!.kind === "draft" && same(entries[k]!, d)) return k; return -1; })();
  const mine = entries.slice(0, index).map((e, k) => ({ e, k })).filter(({ e }) => same(e, d));
  const target = mine.filter(({ e }) => e.kind === "read" && (d.replyTo !== undefined ? e.id === d.replyTo : !!d.replyFrom && e.from === d.replyFrom)).pop()?.e;
  const client = target?.from;
  const inWindow = (k: number) => k > prev;

  const reads = mine.filter(({ e, k }) => e.kind === "read" && (e.id === d.replyTo || (e.from ? (client ? e.from === client : inWindow(k)) : inWindow(k))));
  const readIds = [...new Set(reads.map(({ e }) => e.id).filter((n): n is number => n !== undefined))];
  const finds = mine.filter(({ e, k }) => {
    if (e.kind !== "find" || !e.sender) return false;
    return client ? e.sender.includes(client) || client.includes(e.sender) : inWindow(k);
  });
  const known = finds.map(({ e }) => e.ids).filter((x): x is number[] => Array.isArray(x));
  const found = known.length ? Math.max(...known.map((x) => x.length)) : null;
  const required = Math.max(1, Math.min(found ?? 3, 3));
  const profile = mine.some(({ e, k }) => e.kind === "notion" && e.op !== "update" && e.op !== "create" && (e.emails?.length ? !!client && e.emails.includes(client) : inWindow(k)));
  const facts = mine.filter(({ e, k }) => e.kind === "knowledge" && inWindow(k)).length;

  let maxSim = 0;
  let similarTo: number | null = null;
  for (let k = 0; k < index; k++) {
    const e = entries[k]!;
    if (e.kind !== "draft" || !e.fp || !d.fp) continue;
    const s = sim(d.fp, e.fp);
    if (s > maxSim) { maxSim = s; similarTo = k; }
  }
  const missing: string[] = [];
  if (!target) missing.push("(a) get_message_content of the message being answered");
  if (!finds.length) missing.push("(b) find_messages with this client's address as sender (the history lookup)");
  // With no history search nothing says how many messages the client has: three are asked for until a search says fewer.
  if (readIds.length < required) missing.push(`(c) ${required} message(s) of this client opened (${readIds.length} so far${found === null ? `; ${required} because no history search said how many there are` : ""})`);
  if (!profile) missing.push("(d) the client's Notion record (query by Email, or notion-fetch)");
  return { ...(client ? { client } : {}), targetRead: !!target, ...(target?.id !== undefined ? { targetId: target.id } : {}), historyFind: finds.length > 0, found, read: readIds.length, readIds, required, profile, facts, maxSim, similarTo, index, verdict: judgeSimilarity({ maxSim }), missing };
}

/**
 * The ledger line of a call. A reply's sketch is taken with the client's own name and address removed, so a body that
 * differs from another only by the swapped name still matches it; the client comes from the read of the answered message.
 */
export function entryFor(entries: readonly LedgerEntry[], call: CallRecord, o: SummarizeOptions & { aid?: string } = {}): LedgerEntry | null {
  const first = summarizeCall(call, o);
  if (!first) return null;
  const entry: LedgerEntry = { ...first, ...(o.aid ? { aid: o.aid } : {}) };
  if (entry.kind !== "draft") return entry;
  const client = observeDraft([...entries, entry], entries.length).client;
  if (!client) return entry;
  return { ...summarizeCall(call, { ...o, names: [...(o.names ?? []), client] })!, ...(o.aid ? { aid: o.aid } : {}) };
}

/** The guard's decision for a `create_reply` about to run: the reply as a pending entry, observed against the session so far. */
export function preDraftCheck(entries: readonly LedgerEntry[], call: CallRecord, o: SummarizeOptions & { aid?: string } = {}): { observation: Observation | null; violations: string[] } {
  // P85b: a new thread (`draft_write` with `to`) answers no message, so the mail chain is not asked of it: the client is taken
  // from the project's Notion Clients, so a Notion read of this session (and subagent) must come first.
  const ni = obj(call.input);
  if (call.name === HUB_DRAFT_WRITE && typeof ni.to === "string" && ni.draft === undefined) {
    const read = entries.some((e) => e.kind === "notion" && e.op !== "update" && e.op !== "create" && (e.aid ?? "") === (o.aid ?? ""));
    return { observation: null, violations: read ? [] : [`a new message to ${lower(ni.to)}: read this client's record in the project's Notion Clients first (no Notion read in this session)`] };
  }
  const entry = entryFor(entries, call, o);
  if (!entry || entry.kind !== "draft") return { observation: null, violations: [] };
  const all = [...entries, entry];
  const ob = observeDraft(all, all.length - 1);
  const violations: string[] = [];
  // P60 finding 3: once the answered message was read, say so, so a warning about the rest of the chain is not read as
  // "drafted before reading" (saas 2026-11-19 14:26: the message was read, the history search and Notion were not).
  if (ob.missing.length) {
    const head = ob.targetRead
      ? `the message being answered${ob.targetId !== undefined ? ` (${ob.targetId})` : ""} was read; the rest of this client's thread and profile was not`
      : "read this client's thread and profile first";
    violations.push(`${head}: missing ${ob.missing.join("; ")}`);
  }
  if (ob.verdict.level === "red") violations.push(`this reply is a near-copy of an earlier one in this session (${ob.verdict.reasons.join("; ")}): write it from this client's own thread`);
  return { observation: ob, violations };
}

export interface ClaimedRecord { email?: string; mailRef?: string; context?: unknown }

/** `hub record-draft` calls inside a Bash command: the JSON the agent piped in. Best effort (an `echo '...' | ... record-draft` form). */
export function claimsFromBash(command: string): ClaimedRecord[] {
  if (!/record-draft/.test(command)) return [];
  const out: ClaimedRecord[] = [];
  for (const m of command.matchAll(/echo\s+'([\s\S]*?)'\s*\|/g)) {
    try {
      const j = obj(JSON.parse(m[1]!));
      out.push({ ...(typeof j.email === "string" ? { email: lower(j.email) } : {}), ...(typeof j.mailRef === "string" ? { mailRef: j.mailRef } : {}), ...(j.context !== undefined ? { context: j.context } : {}) });
    } catch { /* not JSON */ }
  }
  return out;
}

export interface EvidenceRow {
  client: string;
  read: string;
  profile: string;
  facts: number;
  anchors: string;
  maxSim: number;
  verdict: "ok" | "amber" | "red";
  notes: string[];
}

/** Rows of the audit table, one per `create_reply`, from the entries of one session (main plus subagents, in order) and the claims made after each draft. */
export function auditEvidence(entries: readonly LedgerEntry[], claims: ReadonlyArray<{ after: number; claim: ClaimedRecord }> = []): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  entries.forEach((e, idx) => {
    if (e.kind !== "draft") return;
    const o = observeDraft(entries, idx);
    const claim = claims.filter((c) => c.after >= idx).sort((a, b) => a.after - b.after).find((c) => !c.claim.email || !o.client || c.claim.email === o.client);
    const ctx = obj(claim?.claim.context);
    const claimedRead = Number(obj(ctx.thread).read);
    const anchors = Array.isArray(ctx.anchors) ? ctx.anchors.length : null;
    const notes: string[] = [];
    let verdict: EvidenceRow["verdict"] = "ok";
    const raise = (l: "amber" | "red", why: string) => { notes.push(why); if (l === "red" || verdict === "ok") verdict = l; };
    if (!o.targetRead) raise("red", "message answered was never opened");
    if (!o.historyFind) raise("red", "no history search");
    if (o.read < o.required) raise("red", `opened ${o.read} of ${o.required} required`);
    if (!o.profile) raise("red", "profile not read");
    if (o.facts < 1) raise("amber", "no knowledge search");
    if (o.verdict.level !== "ok") raise(o.verdict.level, o.verdict.reasons.join("; "));
    if (Number.isFinite(claimedRead) && claimedRead > o.read) raise("red", `claims ${claimedRead} read, observed ${o.read}`);
    if (!claim) raise("amber", "draft was never recorded with context");
    else if (anchors === null) raise("amber", "recorded without anchors");
    const label = o.client ?? (claim?.claim.email ?? `reply to message ${e.replyTo ?? "?"}`);
    rows.push({ client: label, read: `${o.read}/${o.required}`, profile: o.profile ? "read" : "no", facts: o.facts, anchors: anchors === null ? "-" : String(anchors), maxSim: Math.round(o.maxSim * 100) / 100, verdict, notes });
  });
  return rows;
}

/**
 * Rebuilds ledger entries from a finished transcript (the offline twin of the hooks). Appends to `entries` and `claims`
 * in place so the main session and its subagents can be replayed one after another into one session.
 */
export function replayCalls(calls: readonly CallRecord[], entries: LedgerEntry[], claims: Array<{ after: number; claim: ClaimedRecord }>, aid?: string): void {
  for (const c of calls) {
    const e = entryFor(entries, c, aid ? { aid } : {});
    if (e) entries.push(e);
    if (c.name === "Bash") for (const claim of claimsFromBash(String(obj(c.input).command ?? ""))) claims.push({ after: entries.length, claim });
  }
}
