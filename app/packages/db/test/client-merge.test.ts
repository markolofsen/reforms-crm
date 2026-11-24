import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "../src/client";
import { RepoError } from "../src/errors";
import { createRepos, type Repos } from "../src/index";

// P141 C1-C5: a client keyed by its Hub id, found by any identity, created without an email, merged when its email arrives later,
// and renamed only by the profile rule.

let handle: DbHandle;
let repos: Repos;
const rows = (sql: string) => handle.db.$client.prepare(sql).all();

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

describe("a client without an email", () => {
  it("is created, found by its chat, its phone or its Notion card, and two of them never collide on a null email", async () => {
    const a = await repos.clients.create({ project: "p", email: null, name: "WhatsApp +966544555430", notionPageId: "page-a" });
    const b = await repos.clients.create({ project: "p", email: null, name: "Telegram @bob" });
    await repos.messengers.addIdentifier("p", a, "whatsapp", "+966544555430");
    await repos.messengers.addIdentifier("p", b, "telegram_username", "bob");
    expect(await repos.clients.findByIdentity("p", "whatsapp", "+966 54 455 5430")).toBe(a);
    expect(await repos.clients.findByIdentity("p", "telegram_username", "@Bob")).toBe(b);
    expect(await repos.clients.findByNotionPage("p", "page-a")).toBe(a);
    expect(await repos.clients.findByIdentity("p", "email", "nobody@example.test")).toBeUndefined();
  });

  it("takes an Email only into an empty one", async () => {
    const a = await repos.clients.create({ project: "p", email: null, name: "Qimma" });
    expect(await repos.clients.setEmailIfEmpty("p", a, "q@example.test")).toBe(true);
    expect(await repos.clients.setEmailIfEmpty("p", a, "other@example.test")).toBe(false);
    expect((await repos.clients.get("p", a))?.email).toBe("q@example.test");
  });

  it("is renamed only from a number to a real name, never the other way", async () => {
    const a = await repos.clients.create({ project: "p", email: null, name: "+966544555430" });
    expect(await repos.clients.renameIfBetter("p", a, "WhatsApp +966544555430")).toBe(false);
    expect(await repos.clients.renameIfBetter("p", a, "Qimma Khalid")).toBe(true);
    expect(await repos.clients.renameIfBetter("p", a, "+966544555430")).toBe(false);
    expect((await repos.clients.get("p", a))?.name).toBe("Qimma Khalid");
  });
});

describe("merge (C4)", () => {
  it("moves the chat-only client's identifiers, drafts and marks to the client with the email, keeps the old row merged, and writes one Activity line", async () => {
    const chatOnly = await repos.clients.create({ project: "p", email: null, name: "Qimma", notionPageId: "page-q" });
    const mail = await repos.clients.create({ project: "p", email: "q@example.test", name: "q@example.test" });
    await repos.messengers.addIdentifier("p", chatOnly, "whatsapp", "+966544555430");
    await repos.messengers.knowChat("p", "whatsapp", "+966544555430", { title: "Qimma" });
    await repos.messengers.createDraft({ project: "p", channel: "whatsapp", chatId: "+966544555430", text: "Hi", createdBy: "agent", clientId: chatOnly });
    await repos.clients.setMarks(chatOnly, ["vip"]);
    const r = await repos.clients.merge("p", chatOnly, mail, { by: "owner", at: "2026-11-25T10:00:00.000Z" });
    expect(r.into).toBe(mail);
    expect(await repos.messengers.clientByIdentifier("p", "whatsapp", "+966544555430")).toBe(mail);
    expect(rows("select client_id from messenger_drafts")).toEqual([{ client_id: mail }]);
    expect(rows(`select id, email, name, notion_page_id, merged_into from clients order by id`)).toEqual([
      { id: chatOnly, email: null, name: "Qimma", notion_page_id: null, merged_into: mail },
      { id: mail, email: "q@example.test", name: "Qimma", notion_page_id: "page-q", merged_into: null },
    ]);
    // A lookup that still finds the old row is followed to the survivor.
    expect(await repos.clients.findByIdentity("p", "email", "q@example.test")).toBe(mail);
    const act = await repos.runs.activity("p");
    expect(act.rows.map((x) => x.client?.id)).toEqual([mail]);
  });

  it("refuses itself, another project's client, a merged one, and two open mail drafts", async () => {
    const a = await repos.clients.create({ project: "p", email: null, name: "A" });
    const b = await repos.clients.create({ project: "p", email: "b@example.test", name: "B" });
    const other = await repos.clients.create({ project: "q", email: "o@example.test", name: "O" });
    await expect(repos.clients.merge("p", a, a, { by: "owner" })).rejects.toBeInstanceOf(RepoError);
    await expect(repos.clients.merge("p", a, other, { by: "owner" })).rejects.toMatchObject({ code: "not_found" });
    await repos.clients.merge("p", a, b, { by: "owner" });
    await expect(repos.clients.merge("p", a, b, { by: "owner" })).rejects.toMatchObject({ code: "wrong_state" });
  });
});
