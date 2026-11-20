import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHAT_RULES } from "@hub/config/chat-rules";
import { openDb, type DbHandle } from "./client";
import { RepoError } from "./errors";
import { createRepos, rulesOf, type NewMessengerMessage, type Repos } from "./index";

// P71 M2b: the rules of a linked chat (migration 0025), what a chat holds, and unlinking with its rows (research 26 gap 1).

let handle: DbHandle;
let repos: Repos;
let ann: number;

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  ann = await repos.clients.create({ project: "a", email: "ann@a.test", name: "Ann" });
  await repos.messengers.allowChat("a", "telegram_user", "42", "Ann");
  await repos.messengers.allowChat("a", "telegram_user", "43", "Other");
});
afterEach(() => handle.close());

const msg = (o: Partial<NewMessengerMessage> = {}): NewMessengerMessage => ({ project: "a", channel: "telegram_user", account: "1", chatId: "42", remoteMessageId: "1", direction: "in", kind: "text", text: "hi", sentAt: "2026-11-14T10:00:00.000Z", retainUntil: "2027-02-12T10:00:00.000Z", ...o });
const count = (table: string) => (handle.db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

describe("chat rules", () => {
  it("a linked chat starts with the defaults of @hub/config/chat-rules", async () => {
    const row = await repos.messengers.chat("a", "telegram_user", "42");
    expect(row && rulesOf(row)).toEqual(DEFAULT_CHAT_RULES);
    expect(await repos.messengers.chat("b", "telegram_user", "42")).toBeNull();
  });

  it("the setter stores a patch, trims the instruction and refuses values out of bounds", async () => {
    const row = await repos.messengers.setChatRules("a", "telegram_user", "42", { replyMode: "on_request", mayNudge: true, nudgeAfterDays: 7, instruction: "  Formal.  ", language: "ru" }, "2026-11-20T00:00:00.000Z");
    expect(rulesOf(row)).toEqual({ replyMode: "on_request", mayNudge: true, nudgeAfterDays: 7, instruction: "Formal.", language: "ru", prefilter: false });
    expect(row.rulesUpdatedAt).toBe("2026-11-20T00:00:00.000Z");
    for (const bad of [{ nudgeAfterDays: 0 }, { nudgeAfterDays: 61 }, { instruction: "x".repeat(4001) }, { language: "not a tag" }]) {
      await expect(repos.messengers.setChatRules("a", "telegram_user", "42", bad)).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(repos.messengers.setChatRules("a", "telegram_user", "999", { replyMode: "off" })).rejects.toBeInstanceOf(RepoError);
    expect(await repos.messengers.chat("a", "telegram_user", "999")).toBeNull();
  });

  it("the migration's CHECKs refuse what the setter refuses, even written by hand", () => {
    const sql = handle.db.$client;
    expect(() => sql.prepare("update messenger_chats set reply_mode = 'auto'").run()).toThrow(/CHECK/);
    expect(() => sql.prepare("update messenger_chats set nudge_after_days = 0").run()).toThrow(/CHECK/);
    expect(() => sql.prepare("update messenger_chats set instruction = ?").run("x".repeat(4001))).toThrow(/CHECK/);
  });
});

describe("chat activity and the open draft", () => {
  it("counts inbound rows and the newest of each direction; the open draft is the newest still waiting", async () => {
    expect(await repos.messengers.activity("a", "telegram_user", "42")).toEqual({ inbound: 0, lastInAt: null, lastOutAt: null });
    await repos.messengers.insertMessage(msg({ remoteMessageId: "1", direction: "in", sentAt: "2026-11-14T10:00:00.000Z" }));
    await repos.messengers.insertMessage(msg({ remoteMessageId: "2", direction: "out", sentAt: "2026-11-15T10:00:00.000Z" }));
    expect(await repos.messengers.activity("a", "telegram_user", "42")).toEqual({ inbound: 1, lastInAt: "2026-11-14T10:00:00.000Z", lastOutAt: "2026-11-15T10:00:00.000Z" });
    const d = await repos.messengers.createDraft({ project: "a", channel: "telegram_user", chatId: "42", text: "v1", createdBy: "agent", ownerRequest: "ответь", nudge: true });
    expect(d).toMatchObject({ ownerRequest: "ответь", nudge: true });
    expect((await repos.messengers.openDraft("a", "telegram_user", "42"))?.id).toBe(d.id);
    expect((await repos.messengers.reviseDraft("a", d.id, "v2")).text).toBe("v2");
    await repos.messengers.discardDraft("a", d.id);
    expect(await repos.messengers.openDraft("a", "telegram_user", "42")).toBeNull();
    await expect(repos.messengers.reviseDraft("a", d.id, "v3")).rejects.toMatchObject({ code: "wrong_state" });
  });
});

describe("unlink (research 26 gap 1)", () => {
  it("deletes the chat's messages and drafts with its row, in one transaction, and leaves other chats alone (M2b done-when)", async () => {
    await repos.messengers.insertMessage(msg({ remoteMessageId: "1" }));
    await repos.messengers.insertMessage(msg({ remoteMessageId: "2", direction: "out" }));
    await repos.messengers.insertMessage(msg({ chatId: "43", remoteMessageId: "1" }));
    await repos.messengers.createDraft({ project: "a", channel: "telegram_user", chatId: "42", text: "x", createdBy: "agent", clientId: ann });
    await repos.messengers.createDraft({ project: "a", channel: "telegram_user", chatId: "43", text: "y", createdBy: "agent" });
    expect(await repos.messengers.unlinkChat("a", "telegram_user", "42")).toEqual({ removed: true, messages: 2, drafts: 1 });
    expect(await repos.messengers.messagesOf("a", [{ channel: "telegram_user", chatId: "42" }], { limit: 10 })).toEqual([]);
    expect((await repos.messengers.listDrafts("a")).map((d) => d.chatId)).toEqual(["43"]);
    expect(await repos.messengers.isAllowed("a", "telegram_user", "42")).toBe(false);
    expect(count("messenger_messages")).toBe(1);
  });

  it("disallowChat, the path of the CLI and the human module, takes the rows too", async () => {
    await repos.messengers.insertMessage(msg());
    expect(await repos.messengers.disallowChat("a", "telegram_user", "42")).toBe(true);
    expect(count("messenger_messages")).toBe(0);
    expect(await repos.messengers.disallowChat("a", "telegram_user", "42")).toBe(false);
  });

  it("a failing delete rolls the whole unlink back", async () => {
    await repos.messengers.insertMessage(msg());
    handle.db.$client.exec("CREATE TRIGGER no_chat_delete BEFORE DELETE ON messenger_chats BEGIN SELECT RAISE(ABORT, 'refused'); END;");
    await expect(repos.messengers.unlinkChat("a", "telegram_user", "42")).rejects.toThrow(/refused/);
    expect(count("messenger_messages")).toBe(1);
    expect(await repos.messengers.isAllowed("a", "telegram_user", "42")).toBe(true);
  });
});
