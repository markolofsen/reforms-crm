import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "./client";
import { RepoError } from "./errors";
import { createRepos, type NewMessengerMessage, type Repos } from "./index";

let handle: DbHandle;
let repos: Repos;
let a: number; // client of project "a"
let b: number; // client of project "b"

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  a = await repos.clients.create({ project: "a", email: "x@a.test", name: "X" });
  b = await repos.clients.create({ project: "b", email: "x@b.test", name: "X" });
});
afterEach(() => handle.close());

const msg = (o: Partial<NewMessengerMessage> = {}): NewMessengerMessage => ({
  project: "a",
  channel: "telegram_bot",
  account: "1",
  chatId: "100",
  remoteMessageId: "1",
  direction: "in",
  kind: "text",
  text: "hi",
  sentAt: "2026-11-14T10:00:00.000Z",
  retainUntil: "2027-02-12T10:00:00.000Z",
  ...o,
});

describe("migration 0003 tables", () => {
  it("exist after openDb", () => {
    const names = (handle.db as any).$client
      .prepare("select name from sqlite_master where type='table' and (name like 'messenger_%' or name = 'client_identifiers')")
      .all()
      .map((r: { name: string }) => r.name)
      .sort();
    expect(names).toEqual(["client_identifiers", "messenger_accounts", "messenger_chats", "messenger_drafts", "messenger_messages"]);
  });
});

describe("allow-list", () => {
  it("is per project and channel; allow is idempotent", async () => {
    await repos.messengers.allowChat("a", "telegram_bot", "100", "Anna");
    await repos.messengers.allowChat("a", "telegram_bot", "100");
    expect(await repos.messengers.isAllowed("a", "telegram_bot", "100")).toBe(true);
    expect(await repos.messengers.isAllowed("b", "telegram_bot", "100")).toBe(false);
    expect(await repos.messengers.isAllowed("a", "whatsapp", "100")).toBe(false);
    expect((await repos.messengers.allowedChats("a"))[0]?.title).toBe("Anna");
    expect(await repos.messengers.disallowChat("a", "telegram_bot", "100")).toBe(true);
    expect(await repos.messengers.disallowChat("a", "telegram_bot", "100")).toBe(false);
  });
});

describe("messages", () => {
  it("dedupes on the remote id", async () => {
    expect(await repos.messengers.insertMessage(msg())).toBe(true);
    expect(await repos.messengers.insertMessage(msg({ text: "changed" }))).toBe(false);
    const rows = await repos.messengers.messagesOf("a", [{ channel: "telegram_bot", chatId: "100" }], { limit: 10 });
    expect(rows.map((r) => r.text)).toEqual(["hi"]);
  });

  it("pages newest first and returns the rows sent exactly at the boundary", async () => {
    for (let i = 1; i <= 4; i++) {
      await repos.messengers.insertMessage(msg({ remoteMessageId: String(i), sentAt: `2026-11-14T10:0${i}:00.000Z` }));
    }
    await repos.messengers.insertMessage(msg({ remoteMessageId: "9", sentAt: "2026-11-14T10:03:00.000Z" })); // tie with 3
    const chats = [{ channel: "telegram_bot" as const, chatId: "100" }];
    const first = await repos.messengers.messagesOf("a", chats, { limit: 2 });
    expect(first.map((r) => r.remoteMessageId)).toEqual(["4", "9"]);
    const next = await repos.messengers.messagesOf("a", chats, { before: "2026-11-14T10:03:00.000Z", limit: 5 });
    expect(next.map((r) => r.remoteMessageId)).toEqual(["9", "3", "2", "1"]);
  });

  it("never mixes projects", async () => {
    await repos.messengers.insertMessage(msg({ project: "b", text: "other" }));
    expect(await repos.messengers.messagesOf("a", [{ channel: "telegram_bot", chatId: "100" }], { limit: 5 })).toEqual([]);
  });

  it("purges only past retain_until", async () => {
    await repos.messengers.insertMessage(msg({ remoteMessageId: "1", retainUntil: "2026-11-01T00:00:00.000Z" }));
    await repos.messengers.insertMessage(msg({ remoteMessageId: "2", retainUntil: "2027-01-01T00:00:00.000Z" }));
    expect(await repos.messengers.purgeExpired("2026-11-14T00:00:00.000Z")).toBe(1);
    const left = await repos.messengers.messagesOf("a", [{ channel: "telegram_bot", chatId: "100" }], { limit: 5 });
    expect(left.map((r) => r.remoteMessageId)).toEqual(["2"]);
  });
});

describe("polling state", () => {
  it("keeps the cursor and clears the error on success", async () => {
    await repos.messengers.markPollError("a", "telegram_bot", "1", "boom", "2026-11-14T10:00:00.000Z");
    expect((await repos.messengers.account("a", "telegram_bot", "1"))?.lastError).toBe("boom");
    await repos.messengers.markPollOk("a", "telegram_bot", "1", "42", "2026-11-14T10:01:00.000Z");
    const row = await repos.messengers.account("a", "telegram_bot", "1");
    expect(row).toMatchObject({ cursor: "42", lastError: null, lastOkAt: "2026-11-14T10:01:00.000Z" });
    await repos.messengers.markPollError("a", "telegram_bot", "1", "again");
    expect((await repos.messengers.account("a", "telegram_bot", "1"))?.cursor).toBe("42"); // an error keeps the position
  });
});

describe("client identifiers", () => {
  it("are unique per project, kind and value", async () => {
    await repos.messengers.addIdentifier("a", a, "telegram", "100");
    await expect(repos.messengers.addIdentifier("a", a, "telegram", "100")).rejects.toMatchObject({ code: "duplicate_identifier" });
    await expect(repos.clients.create({ project: "a", email: "y@a.test", name: "Y" }).then((id) => repos.messengers.addIdentifier("a", id, "telegram", "100"))).rejects.toBeInstanceOf(RepoError);
    await repos.messengers.addIdentifier("b", b, "telegram", "100"); // same value, other project
    expect(await repos.messengers.clientByIdentifier("a", "telegram", "100")).toBe(a);
    expect(await repos.messengers.clientByIdentifier("b", "telegram", "100")).toBe(b);
  });

  it("refuse a client of another project", async () => {
    await expect(repos.messengers.addIdentifier("a", b, "email", "q@a.test")).rejects.toMatchObject({ code: "not_found" });
    await expect(repos.messengers.identifiersOf("a", b)).rejects.toMatchObject({ code: "not_found" });
  });

  it("remove and list", async () => {
    await repos.messengers.addIdentifier("a", a, "email", "x@a.test");
    await repos.messengers.addIdentifier("a", a, "whatsapp", "+4915100000");
    expect((await repos.messengers.identifiersOf("a", a)).map((r) => r.kind)).toEqual(["email", "whatsapp"]);
    expect((await repos.messengers.removeIdentifier("a", "email", "x@a.test"))?.clientId).toBe(a);
    expect(await repos.messengers.removeIdentifier("a", "email", "x@a.test")).toBeNull();
  });

  it("go with the client", async () => {
    await repos.messengers.addIdentifier("a", a, "telegram", "100");
    (handle.db as any).$client.prepare("delete from clients where id = ?").run(a);
    expect(await repos.messengers.clientByIdentifier("a", "telegram", "100")).toBeNull();
  });
});

describe("outbound drafts", () => {
  const input = { project: "a", channel: "telegram_bot" as const, chatId: "100", text: "Hello", createdBy: "run-1" };

  it("start as draft and follow draft -> confirmed -> sent", async () => {
    const d = await repos.messengers.createDraft(input);
    expect(d.status).toBe("draft");
    const c = await repos.messengers.confirmDraft("a", d.id, "mark");
    expect(c).toMatchObject({ status: "confirmed", confirmedBy: "mark" });
    const s = await repos.messengers.markDraftSent("a", d.id, "77");
    expect(s).toMatchObject({ status: "sent", remoteMessageId: "77" });
  });

  it("refuse out-of-order transitions", async () => {
    const d = await repos.messengers.createDraft(input);
    await expect(repos.messengers.markDraftSent("a", d.id, "1")).rejects.toMatchObject({ code: "wrong_state" });
    await repos.messengers.confirmDraft("a", d.id, "mark");
    await expect(repos.messengers.confirmDraft("a", d.id, "mark")).rejects.toMatchObject({ code: "wrong_state" });
    await expect(repos.messengers.discardDraft("a", d.id)).rejects.toMatchObject({ code: "wrong_state" });
  });

  it("are scoped to the project", async () => {
    const d = await repos.messengers.createDraft(input);
    await expect(repos.messengers.confirmDraft("b", d.id, "mark")).rejects.toMatchObject({ code: "not_found" });
    expect(await repos.messengers.getDraft("b", d.id)).toBeNull();
  });

  it("lists by status", async () => {
    const d1 = await repos.messengers.createDraft(input);
    await repos.messengers.createDraft(input);
    await repos.messengers.discardDraft("a", d1.id);
    expect((await repos.messengers.listDrafts("a", ["draft"])).length).toBe(1);
    expect((await repos.messengers.listDrafts("a")).length).toBe(2);
  });
});
