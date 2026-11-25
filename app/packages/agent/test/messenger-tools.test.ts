import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHAT_RULES } from "@hub/config/chat-rules";
import { createRepos, openDb, openDbReadOnly, type DbHandle, type Repos } from "@hub/db";
import { createHubMcpServer } from "../src/mcp/server";
import { draftVerdict, NO_INBOUND } from "../src/messenger/rules";
import type { WithRepos } from "../src/mail/write-log";

// P71 M2 and M2b: the agent's two messenger tools driven over MCP against a throwaway database (the fake store): no Telegram,
// no WhatsApp, no network. The tools read through a read-only handle and write on a short connection, as `hub mcp` does.

let dir: string;
let db: string;
let rw: DbHandle;
let ro: DbHandle;
let w: Repos;
let repos: Repos;
const NOW = new Date("2026-11-20T12:00:00Z");
const ids = { ann: 0, zed: 0, silent: 0 };

const msg = (chatId: string, remote: string, direction: "in" | "out", sentAt: string, project = "acme") => ({ project, channel: "telegram_user" as const, account: "1", chatId, remoteMessageId: remote, direction, kind: "text", text: direction === "in" ? `client says ${remote}` : `we said ${remote}`, sentAt, retainUntil: "2027-02-18T00:00:00.000Z" });

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-messenger-tools-"));
  db = path.join(dir, "app.db");
  rw = openDb(db);
  w = createRepos(rw.db);
  ids.ann = await w.clients.create({ project: "acme", email: "ann@example.com", name: "Ann" });
  ids.zed = await w.clients.create({ project: "beta", email: "zed@example.com", name: "Zed Secret" });
  // acme: chat 42 linked to Ann (her last message is the newest); chat 43 linked with no message at all; chat 44 known, not linked.
  ids.silent = await w.clients.create({ project: "acme", email: null, name: "Silent" });
  await w.messengers.addIdentifier("acme", ids.ann, "telegram", "42");
  await w.messengers.knowChat("acme", "telegram_user", "42", { title: "Ann" });
  await w.messengers.addIdentifier("acme", ids.silent, "telegram", "43");
  await w.messengers.knowChat("acme", "telegram_user", "43", { title: "Silent" });
  await w.messengers.knowChat("acme", "telegram_user", "44", { title: "Qimma", username: "qimma_k" });
  await w.messengers.insertMessage(msg("44", "1", "in", "2026-11-19T08:00:00.000Z"));
  await w.messengers.insertMessage(msg("42", "1", "out", "2026-11-18T09:00:00.000Z"));
  await w.messengers.insertMessage(msg("42", "2", "in", "2026-11-19T09:00:00.000Z"));
  // beta: its own chat 77, never visible from acme.
  await w.messengers.addIdentifier("beta", ids.zed, "telegram", "77");
  await w.messengers.knowChat("beta", "telegram_user", "77", { title: "Zed Secret" });
  await w.messengers.insertMessage(msg("77", "1", "in", "2026-11-19T09:00:00.000Z", "beta"));
  ro = openDbReadOnly(db);
  repos = createRepos(ro.db);
});
afterEach(() => {
  ro.close();
  rw.close();
  rmSync(dir, { recursive: true, force: true });
});

const withRepos: WithRepos = async (fn) => {
  const h = openDb(db);
  try {
    return await fn(createRepos(h.db));
  } finally {
    h.close();
  }
};

/** A messenger tool's reply as these tests read it: the chats of messenger_history, a draft id, a refusal code; the rest by key. */
type HistoryChat = Record<string, unknown> & { chat_id: string; messages: Array<{ direction: string; text: string; hidden?: string }>; prefilter: Record<string, unknown>; can_draft: unknown };
type ToolReply = Record<string, unknown> & { chats: [HistoryChat, ...HistoryChat[]]; draft: number; error?: string };
async function connect(hubProject: string | undefined, write = true, policy?: { language: string | null; instruction: string | null }, attended?: { ownerWords: (slug: string, words: string) => boolean }) {
  const server = createHubMcpServer(repos, {
    hubProject,
    ...(attended ? { ownerWords: attended.ownerWords, agentSend: async () => ({ ok: false as const, reason: "refused", error: "test", next: "test" }) as never } : {}),
    focusFile: path.join(dir, "focus.json"),
    now: () => NOW,
    ...(write ? { withRepos } : {}),
    ...(policy ? { projectMail: () => ({ accounts: [], sender: null, messengers: policy }) } : {}),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    return { isError: res.isError === true, json: JSON.parse(text) as ToolReply };
  };
}

const chat42 = { channel: "telegram_user", chat_id: "42" };
const drafts = () => w.messengers.listDrafts("acme");

describe("messenger_history", () => {
  it("returns a linked chat with its rules, the owner's instruction apart from the messages, and what a draft would get", async () => {
    await w.messengers.setChatRules("acme", "telegram_user", "42", { instruction: "Formal; never quote prices.", language: "ru" });
    const call = await connect("acme");
    const r = await call("messenger_history", chat42);
    expect(r.isError).toBe(false);
    const c = r.json.chats[0];
    expect(c).toMatchObject({ channel: "telegram_user", chat_id: "42", client: { id: ids.ann, name: "Ann" }, rules: { reply_mode: "draft", language: "ru", prefilter: false }, owner_instruction: { text: "Formal; never quote prices." }, can_draft: { ok: true, nudge: false }, open_draft: null });
    expect(c.messages.map((m: { direction: string }) => m.direction)).toEqual(["in", "out"]);
  });

  it("applies project language and instruction defaults, while a chat exception wins", async () => {
    const call = await connect("acme", true, { language: "id-ID", instruction: "Keep every reply concise." });
    const global = (await call("messenger_history", chat42)).json.chats[0];
    expect(global).toMatchObject({ rules: { language: "id-ID" }, owner_instruction: { text: "Keep every reply concise." } });
    await w.messengers.setChatRules("acme", "telegram_user", "42", { language: "ru", instruction: "Use formal Russian." });
    const local = (await call("messenger_history", chat42)).json.chats[0];
    expect(local).toMatchObject({ rules: { language: "ru" }, owner_instruction: { text: "Use formal Russian." } });
  });

  it("P71 M-P: with the pre-analysis on, a hidden message is left out and counted; include_hidden marks it; an unjudged one is shown", async () => {
    await w.messengers.setChatRules("acme", "telegram_user", "42", { prefilter: true });
    await w.messengers.insertMessage(msg("42", "3", "in", "2026-11-19T10:00:00.000Z"));
    await w.messengers.insertMessage(msg("42", "4", "in", "2026-11-19T11:00:00.000Z"));
    const id = (remote: string) => (rw.db.$client.prepare("select id from messenger_messages where chat_id = '42' and remote_message_id = ?").get(remote) as { id: number }).id;
    await w.messengers.recordTriage("acme", [
      { messageId: id("2"), verdict: "needs_reply", model: "m", promptVersion: 1 },
      { messageId: id("3"), verdict: "closing", model: "m", promptVersion: 1 },
      { messageId: id("4"), verdict: "unjudged", model: null, promptVersion: 1 },
    ]);
    const call = await connect("acme");
    const c = (await call("messenger_history", chat42)).json.chats[0];
    expect(c.prefilter).toMatchObject({ on: true, hidden: { closing: 1, automated: 0, personal: 0 }, unjudged: 1, left_out_below: 1, newest_in_hidden: null });
    expect(c.messages.map((m: { text: string }) => m.text)).toEqual(["client says 4", "client says 2", "we said 1"]);
    const all = (await call("messenger_history", { ...chat42, include_hidden: true })).json.chats[0];
    expect(all.messages.map((m: { text: string; hidden?: string }) => [m.text, m.hidden ?? null])).toEqual([
      ["client says 4", null],
      ["client says 3", "closing"],
      ["client says 2", null],
      ["we said 1", null],
    ]);
    expect(all.prefilter.left_out_below).toBe(0);
    // The client's newest message hidden: the block says so (no reply owed).
    await w.messengers.insertMessage(msg("42", "5", "in", "2026-11-19T12:00:00.000Z"));
    await w.messengers.recordTriage("acme", [{ messageId: id("5"), verdict: "automated", model: "m", promptVersion: 1 }]);
    expect((await call("messenger_history", chat42)).json.chats[0].prefilter.newest_in_hidden).toBe("automated");
    // A chat whose switch was never on carries no prefilter block.
    expect((await call("messenger_history", { channel: "telegram_user", chat_id: "43" })).json.chats[0].prefilter).toBeNull();
  });

  it("by client: every linked chat of that client; a client of another project is not found", async () => {
    const call = await connect("acme");
    const r = await call("messenger_history", { client: ids.ann });
    expect(r.json.chats.map((c: { chat_id: string }) => c.chat_id)).toEqual(["42"]);
    expect(await call("messenger_history", { client: ids.zed })).toMatchObject({ isError: true, json: { error: "not_found" } });
  });

  it("resolves the focused chat ref without treating its row id as the external chat id", async () => {
    const row = await w.messengers.chat("acme", "telegram_user", "42");
    const foreign = await w.messengers.chat("beta", "telegram_user", "77");
    expect(row).not.toBeNull();
    expect(foreign).not.toBeNull();
    const call = await connect("acme");
    const r = await call("messenger_history", { chat: row!.id });
    expect(r.isError).toBe(false);
    expect(r.json.chats[0]).toMatchObject({ channel: "telegram_user", chat_id: "42", client: { id: ids.ann, name: "Ann" } });
    expect(await call("messenger_history", { chat: foreign!.id })).toMatchObject({ isError: true, json: { error: "not_linked" } });
  });

  it("refuses an unlinked chat and another project's chat alike, naming nothing of it", async () => {
    const call = await connect("acme");
    const unlinked = await call("messenger_history", { channel: "telegram_user", chat_id: "999" });
    const foreign = await call("messenger_history", { channel: "telegram_user", chat_id: "77" });
    expect(unlinked).toMatchObject({ isError: true, json: { error: "not_linked" } });
    expect(foreign).toMatchObject({ isError: true, json: { error: "not_linked" } });
    expect(JSON.stringify(foreign.json)).not.toMatch(/Zed|beta-only|client says/);
  });

  it("refuses an unbound session", async () => {
    const call = await connect(undefined);
    expect(await call("messenger_history", chat42)).toMatchObject({ isError: true, json: { error: "unbound" } });
  });
});

describe("messenger_draft_write", () => {
  it("writes one draft in a linked chat, tied to its client, and never sends", async () => {
    const call = await connect("acme");
    const r = await call("messenger_draft_write", { ...chat42, text: "  Добрый день, Анна!  " });
    expect(r).toMatchObject({ isError: false, json: { action: "created", sent: false, nudge: false } });
    expect(await drafts()).toMatchObject([{ id: r.json.draft, status: "draft", text: "Добрый день, Анна!", clientId: ids.ann, createdBy: "agent", nudge: false, ownerRequest: null }]);
    expect((await w.runs.activity("acme", { view: "drafts" })).rows[0]).toMatchObject({ outcome: "drafted", draftId: null, chatId: expect.any(Number), skill: "messenger-reply", why: "Runtime agent prepared an unsent draft." });
  });

  it("writes through the focused chat ref and still leaves an unsent draft", async () => {
    const row = await w.messengers.chat("acme", "telegram_user", "42");
    expect(row).not.toBeNull();
    const call = await connect("acme");
    const r = await call("messenger_draft_write", { chat: row!.id, text: "Ответ через focus" });
    expect(r).toMatchObject({ isError: false, json: { action: "created", sent: false, channel: "telegram_user", chat_id: "42" } });
    expect((await drafts())[0]).toMatchObject({ text: "Ответ через focus", status: "draft" });
  });

  it("refuses an unlinked chat, another project's chat and an empty text, and writes nothing", async () => {
    const call = await connect("acme");
    expect((await call("messenger_draft_write", { channel: "telegram_user", chat_id: "999", text: "hi" })).json.error).toBe("not_linked");
    expect((await call("messenger_draft_write", { channel: "telegram_user", chat_id: "77", text: "hi" })).json.error).toBe("not_linked");
    expect((await call("messenger_draft_write", { ...chat42, text: "   " })).json.error).toBe("empty_text");
    expect(await drafts()).toEqual([]);
    expect(await w.messengers.listDrafts("beta")).toEqual([]);
  });

  it("reply_mode off refuses a draft (M2b done-when)", async () => {
    await w.messengers.setChatRules("acme", "telegram_user", "42", { replyMode: "off" });
    const call = await connect("acme");
    expect((await call("messenger_draft_write", { ...chat42, text: "hi", owner_request: "ответь Анне" })).json.error).toBe("reply_off");
    expect(await drafts()).toEqual([]);
  });

  it("a chat with no inbound row is refused, even on the owner's words: the hub never writes first (M2b done-when)", async () => {
    const call = await connect("acme");
    expect((await call("messenger_draft_write", { channel: "telegram_user", chat_id: "43", text: "hi", owner_request: "напиши ему" })).json.error).toBe("no_inbound");
    expect((await call("messenger_history", { channel: "telegram_user", chat_id: "43" })).json.chats[0].can_draft).toEqual({ ok: false, code: "no_inbound" });
    expect(await drafts()).toEqual([]);
  });

  it("on_request needs the owner's words, and records them", async () => {
    await w.messengers.setChatRules("acme", "telegram_user", "42", { replyMode: "on_request" });
    const call = await connect("acme");
    expect((await call("messenger_draft_write", { ...chat42, text: "hi" })).json.error).toBe("not_requested");
    const r = await call("messenger_draft_write", { ...chat42, text: "hi", owner_request: "ответь Анне про встречу" });
    expect(r.isError).toBe(false);
    expect((await drafts())[0]?.ownerRequest).toBe("ответь Анне про встречу");
  });

  it("a draft after our own last message is created at once, marked nudge (no follow-up rule, owner 2026-11-24)", async () => {
    await w.messengers.insertMessage(msg("42", "3", "out", "2026-11-19T10:00:00.000Z"));
    const call = await connect("acme");
    expect((await call("messenger_history", chat42)).json.chats[0].can_draft).toEqual({ ok: true, nudge: true });
    expect((await call("messenger_draft_write", { ...chat42, text: "Напоминаю" })).json).toMatchObject({ action: "created", nudge: true, sent: false });
    expect(await drafts()).toMatchObject([{ text: "Напоминаю", status: "draft", nudge: true }]);
  });

  it("an open draft makes a rerun already_drafted; draft=<id> revises it in place", async () => {
    const call = await connect("acme");
    const first = await call("messenger_draft_write", { ...chat42, text: "v1" });
    expect(await call("messenger_draft_write", { ...chat42, text: "v2" })).toMatchObject({ isError: true, json: { error: "already_drafted" } });
    const rev = await call("messenger_draft_write", { ...chat42, text: "v2", draft: first.json.draft });
    expect(rev.json).toMatchObject({ action: "revised", draft: first.json.draft });
    expect((await drafts()).map((d) => d.text)).toEqual(["v2"]);
    expect((await call("messenger_draft_write", { ...chat42, text: "v3", draft: first.json.draft + 100 })).json.error).toBe("not_found");
  });

  it("without a write connection it refuses unavailable", async () => {
    const call = await connect("acme", false);
    expect((await call("messenger_draft_write", { ...chat42, text: "hi" })).json.error).toBe("unavailable");
  });
});

describe("draftVerdict", () => {
  const act = (o: Partial<{ inbound: number; lastInAt: string | null; lastOutAt: string | null }> = {}) => ({ inbound: 1, lastInAt: "2026-11-19T09:00:00.000Z", lastOutAt: null, ...o });
  it("off wins over everything; first contact is refused; on_request needs the owner's words; our own last message is no bar", () => {
    expect(draftVerdict({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "off" }, activity: act({ inbound: 0 }), ownerRequest: "ответь ему" }).refusal?.code).toBe("reply_off");
    expect(draftVerdict({ rules: DEFAULT_CHAT_RULES, activity: act({ inbound: 0, lastInAt: null, lastOutAt: "2026-11-19T10:00:00.000Z" }), ownerRequest: "напиши ему" }).refusal?.code).toBe("no_inbound");
    expect(draftVerdict({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "on_request" }, activity: act(), ownerRequest: "ok" }).refusal?.code).toBe("not_requested");
    expect(draftVerdict({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "on_request" }, activity: act({ lastOutAt: "2026-11-19T10:00:00.000Z" }), ownerRequest: "напомни ему" })).toEqual({ refusal: null, nudge: true });
    expect(draftVerdict({ rules: DEFAULT_CHAT_RULES, activity: act({ lastOutAt: "2026-11-19T10:00:00.000Z" }) })).toEqual({ refusal: null, nudge: true });
    expect(draftVerdict({ rules: DEFAULT_CHAT_RULES, activity: act() })).toEqual({ refusal: null, nudge: false });
  });
  it("P141 W4: the proof of inbound is the server's fact (lastInAt), so a pruned cache still drafts; no fact is the new refusal sentence", () => {
    // The client wrote 31 days ago: the cache let the row go, the chat row's last_inbound_at kept the fact.
    expect(draftVerdict({ rules: DEFAULT_CHAT_RULES, activity: act({ inbound: 0, lastInAt: "2026-10-20T09:00:00.000Z" }) }).refusal).toBeNull();
    expect(draftVerdict({ rules: DEFAULT_CHAT_RULES, activity: act({ inbound: 0, lastInAt: null }) }).refusal).toEqual({ code: "no_inbound", message: NO_INBOUND });
    expect(NO_INBOUND).toMatch(/^No message from this person is stored yet; if they wrote, the Hub has not received it\. Refresh the chat/);
    expect(NO_INBOUND).toMatch(/the owner's word that they wrote does not change that/);
  });
});

describe("P143 L1: in a session the owner started, any chat of the project is read, linked or not; never in a background run", () => {
  const chat44 = { channel: "telegram_user", chat_id: "44" };
  const owner = { ownerWords: () => true };

  it("is not_linked in a background run (no send port)", async () => {
    const call = await connect("acme");
    expect((await call("messenger_history", chat44)).json.error).toBe("not_linked");
    expect((await call("messenger_draft_write", { ...chat44, text: "Hello" })).json.error).toBe("not_linked");
  });

  it("is read and drafted in an attended session with no naming asked (the chat in focus is named)", async () => {
    const call = await connect("acme", true, undefined, owner);
    const h = await call("messenger_history", chat44);
    expect(h.isError).toBe(false);
    expect(h.json.chats[0]).toMatchObject({ chat_id: "44", client: null, done: null });
    const d = await call("messenger_draft_write", { ...chat44, text: "Мы на связи." });
    expect(d.isError).toBe(false);
    expect((await drafts()).find((x) => x.chatId === "44")).toMatchObject({ clientId: null, status: "draft" });
  });

  it("an unknown chat stays not_linked, attended or not", async () => {
    const call = await connect("acme", true, undefined, owner);
    expect((await call("messenger_history", { channel: "telegram_user", chat_id: "999999" })).json.error).toBe("not_linked");
  });
});

describe("P143 D3: conversation_done takes a chat out of Needs you until their next message", () => {
  it("closes a chat through its newest inbound message, logs the reason, and the next message reopens it", async () => {
    const call = await connect("acme");
    const chat = (await w.messengers.chat("acme", "telegram_user", "42"))!;
    const r = await call("conversation_done", { chat: chat.id, reason: "they confirmed with yes" });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ done: true, chat: chat.id, client: ids.ann, name: "Ann" });
    const row = (await w.messengers.chat("acme", "telegram_user", "42"))!;
    expect(row).toMatchObject({ doneBy: "agent", doneReason: "they confirmed with yes", doneThrough: "2026-11-19T09:00:00.000Z" });
    expect((await call("messenger_history", chat42)).json.chats[0]).toMatchObject({ done: { by: "agent", reason: "they confirmed with yes" } });
    // Their next message is newer than what was closed: the chat needs the owner again.
    await w.messengers.insertMessage(msg("42", "9", "in", "2026-11-20T09:00:00.000Z"));
    expect((await call("messenger_history", chat42)).json.chats[0]).toMatchObject({ done: null });
  });

  it("refuses nothing_to_close where they never wrote, and an unlinked chat in a background run", async () => {
    const call = await connect("acme");
    const silent = (await w.messengers.chat("acme", "telegram_user", "43"))!;
    expect((await call("conversation_done", { chat: silent.id, reason: "nothing there" })).json.error).toBe("nothing_to_close");
    const qimma = (await w.messengers.chat("acme", "telegram_user", "44"))!;
    expect((await call("conversation_done", { chat: qimma.id, reason: "a thanks" })).json.error).toBe("not_linked");
  });

  it("client_create and chat_link refuse in a background run (no send port)", async () => {
    const call = await connect("acme");
    const qimma = (await w.messengers.chat("acme", "telegram_user", "44"))!;
    expect((await call("client_create", { chat: qimma.id, name: "Ahmed", company: "Qimma Auctions" })).json.error).toBe("unattended");
    expect((await call("chat_link", { chat: qimma.id, client: ids.ann })).json.error).toBe("unattended");
  });
});
