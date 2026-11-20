import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHAT_RULES } from "@hub/config/chat-rules";
import { createRepos, openDb, openDbReadOnly, type DbHandle, type Repos } from "@hub/db";
import { createHubMcpServer } from "../src/mcp";
import { draftVerdict } from "../src/messenger/rules";
import type { WithRepos } from "../src/write-record";

// P71 M2 and M2b: the agent's two messenger tools driven over MCP against a throwaway database (the fake store): no Telegram,
// no WhatsApp, no network. The tools read through a read-only handle and write on a short connection, as `hub mcp` does.

let dir: string;
let db: string;
let rw: DbHandle;
let ro: DbHandle;
let w: Repos;
let repos: Repos;
const NOW = new Date("2026-11-20T12:00:00Z");
const ids = { ann: 0, zed: 0 };

const msg = (chatId: string, remote: string, direction: "in" | "out", sentAt: string, project = "acme") => ({ project, channel: "telegram_user" as const, account: "1", chatId, remoteMessageId: remote, direction, kind: "text", text: direction === "in" ? `client says ${remote}` : `we said ${remote}`, sentAt, retainUntil: "2027-02-18T00:00:00.000Z" });

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-messenger-tools-"));
  db = path.join(dir, "app.db");
  rw = openDb(db);
  w = createRepos(rw.db);
  ids.ann = await w.clients.create({ project: "acme", email: "ann@example.com", name: "Ann" });
  ids.zed = await w.clients.create({ project: "beta", email: "zed@example.com", name: "Zed Secret" });
  // acme: chat 42 linked to Ann (her last message is the newest); chat 43 linked with no message at all.
  await w.messengers.addIdentifier("acme", ids.ann, "telegram", "42");
  await w.messengers.allowChat("acme", "telegram_user", "42", "Ann");
  await w.messengers.allowChat("acme", "telegram_user", "43", "Silent");
  await w.messengers.insertMessage(msg("42", "1", "out", "2026-11-18T09:00:00.000Z"));
  await w.messengers.insertMessage(msg("42", "2", "in", "2026-11-19T09:00:00.000Z"));
  // beta: its own chat 77, never visible from acme.
  await w.messengers.addIdentifier("beta", ids.zed, "telegram", "77");
  await w.messengers.allowChat("beta", "telegram_user", "77", "Zed Secret");
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

async function connect(hubProject: string | undefined, write = true) {
  const server = createHubMcpServer(repos, { hubProject, focusFile: path.join(dir, "focus.json"), now: () => NOW, ...(write ? { withRepos } : {}) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    return { isError: res.isError === true, json: JSON.parse(text) as Record<string, any> };
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
    expect(c).toMatchObject({ channel: "telegram_user", chat_id: "42", client: { id: ids.ann, name: "Ann" }, rules: { reply_mode: "draft", may_nudge: false, nudge_after_days: 3, language: "ru", prefilter: false }, owner_instruction: { text: "Formal; never quote prices." }, can_draft: { ok: true, nudge: false }, open_draft: null });
    expect(c.messages.map((m: { direction: string }) => m.direction)).toEqual(["in", "out"]);
  });

  it("by client: every linked chat of that client; a client of another project is not found", async () => {
    const call = await connect("acme");
    const r = await call("messenger_history", { client: ids.ann });
    expect(r.json.chats.map((c: { chat_id: string }) => c.chat_id)).toEqual(["42"]);
    expect(await call("messenger_history", { client: ids.zed })).toMatchObject({ isError: true, json: { error: "not_found" } });
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

  it("a chat with no inbound row is refused, even with follow-ups allowed: the hub never writes first (M2b done-when)", async () => {
    await w.messengers.setChatRules("acme", "telegram_user", "43", { mayNudge: true, nudgeAfterDays: 1 });
    const call = await connect("acme");
    expect((await call("messenger_draft_write", { channel: "telegram_user", chat_id: "43", text: "hi" })).json.error).toBe("no_inbound");
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

  it("a follow-up after our own last message: refused with may_nudge off, too soon inside nudge_after_days, then admitted as a nudge", async () => {
    await w.messengers.insertMessage(msg("42", "3", "out", "2026-11-19T10:00:00.000Z"));
    const call = await connect("acme");
    expect((await call("messenger_draft_write", { ...chat42, text: "Напоминаю" })).json.error).toBe("no_nudge");
    await w.messengers.setChatRules("acme", "telegram_user", "42", { mayNudge: true, nudgeAfterDays: 3 });
    expect((await call("messenger_draft_write", { ...chat42, text: "Напоминаю" })).json.error).toBe("too_soon");
    await w.messengers.setChatRules("acme", "telegram_user", "42", { nudgeAfterDays: 1 });
    expect((await call("messenger_draft_write", { ...chat42, text: "Напоминаю" })).json).toMatchObject({ action: "created", nudge: true });
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
  it("off wins over everything; the owner's words never lift may_nudge", () => {
    expect(draftVerdict({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "off" }, activity: act({ inbound: 0 }), now: NOW }).refusal?.code).toBe("reply_off");
    expect(draftVerdict({ rules: DEFAULT_CHAT_RULES, activity: act({ lastOutAt: "2026-11-19T10:00:00.000Z" }), ownerRequest: "напомни ему", now: NOW }).refusal?.code).toBe("no_nudge");
    expect(draftVerdict({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "on_request" }, activity: act(), ownerRequest: "ok", now: NOW }).refusal?.code).toBe("not_requested");
    expect(draftVerdict({ rules: DEFAULT_CHAT_RULES, activity: act(), now: NOW })).toEqual({ refusal: null, nudge: false });
  });
});
