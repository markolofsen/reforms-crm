import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientHistory } from "../src/history";
import { allowChat, humanActor, linkIdentifier } from "../src/human";
import { FakeMail, mailEntry, setup, type Env } from "./helpers";

let env: Env;
const owner = humanActor("owner");
beforeEach(async () => {
  env = await setup();
});
afterEach(() => env.close());

const say = (id: string, sentAt: string, text: string, chatId = "100") =>
  env.repos.messengers.insertMessage({ project: "p", channel: "telegram_bot", account: "1", chatId, remoteMessageId: id, direction: "in", kind: "text", text, sentAt, retainUntil: "2027-12-31T00:00:00.000Z" });

const link = async () => {
  await linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "email", value: "anna@example.test" });
  await linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "telegram", value: "100" });
};

const mail = () =>
  new FakeMail({
    "anna@example.test": [
      mailEntry("<m1@x>", "2026-11-10T09:00:00.000Z"),
      mailEntry("<m2@x>", "2026-11-12T09:00:00.000Z", "out"),
      mailEntry("<m3@x>", "2026-11-14T09:00:00.000Z"),
    ],
  });

describe("clientHistory", () => {
  it("merges mail and messenger rows in time order, newest first", async () => {
    await link();
    await say("1", "2026-11-11T10:00:00.000Z", "tg one");
    await say("2", "2026-11-13T10:00:00.000Z", "tg two");
    const h = await clientHistory({ repos: env.repos, mail: mail() }, "p", env.clientId);
    expect(h.items.map((i) => (i.source === "mail" ? i.entry.id : i.text))).toEqual(["<m3@x>", "tg two", "<m2@x>", "tg one", "<m1@x>"]);
    expect(h.items.map((i) => i.direction)).toEqual(["in", "in", "out", "in", "in"]);
    expect(h.nextCursor).toBeUndefined();
  });

  it("pages across both sources with a cursor and loses or repeats nothing", async () => {
    await link();
    for (let i = 1; i <= 5; i++) await say(String(i), `2026-11-1${i}T12:00:00.000Z`, `tg${i}`);
    const m = mail();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const h = await clientHistory({ repos: env.repos, mail: m }, "p", env.clientId, { limit: 3, ...(cursor ? { cursor } : {}) });
      seen.push(...h.items.map((i) => (i.source === "mail" ? i.entry.id : i.text)));
      cursor = h.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["tg5", "tg4", "<m3@x>", "tg3", "tg2", "<m2@x>", "tg1", "<m1@x>"]);
  });

  it("reads the extra addresses it is given (the client row's own e-mail) once, even when also linked", async () => {
    const m = mail();
    const only = await clientHistory({ repos: env.repos, mail: m }, "p", env.clientId, { emails: ["Anna@Example.test"] });
    expect(only.items.map((i) => (i.source === "mail" ? i.entry.id : ""))).toEqual(["<m3@x>", "<m2@x>", "<m1@x>"]);
    await link();
    const both = await clientHistory({ repos: env.repos, mail: m }, "p", env.clientId, { emails: ["anna@example.test"] });
    expect(both.items).toHaveLength(3);
    expect(m.calls).toBe(2);
  });

  it("works without a mail provider (messenger rows only)", async () => {
    await link();
    await say("1", "2026-11-11T10:00:00.000Z", "only tg");
    const h = await clientHistory({ repos: env.repos }, "p", env.clientId);
    expect(h.items.map((i) => i.source)).toEqual(["messenger"]);
  });

  it("splits a timestamp tie exactly across a page boundary", async () => {
    await link();
    for (const id of ["1", "2", "3"]) await say(id, "2026-11-11T10:00:00.000Z", `same${id}`);
    const a = await clientHistory({ repos: env.repos }, "p", env.clientId, { limit: 2 });
    const b = await clientHistory({ repos: env.repos }, "p", env.clientId, { limit: 2, ...(a.nextCursor ? { cursor: a.nextCursor } : {}) });
    const all = [...a.items, ...b.items].map((i) => (i.source === "messenger" ? i.text : ""));
    expect(all.sort()).toEqual(["same1", "same2", "same3"]);
    expect(b.nextCursor).toBeUndefined();
  });

  it("reports unreadable mail and still returns the rest", async () => {
    await link();
    await say("1", "2026-11-11T10:00:00.000Z", "tg");
    const m = mail();
    m.fail = { code: "not_allowed" };
    const h = await clientHistory({ repos: env.repos, mail: m }, "p", env.clientId);
    expect(h.mailUnavailable).toEqual([{ address: "anna@example.test", code: "not_allowed" }]);
    expect(h.items).toHaveLength(1);
  });

  it("dedupes a message that appears under two linked addresses", async () => {
    await link();
    await linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "email", value: "anna@work.test" });
    const e = mailEntry("<same@x>", "2026-11-14T09:00:00.000Z");
    const m = new FakeMail({ "anna@example.test": [e], "anna@work.test": [e] });
    const h = await clientHistory({ repos: env.repos, mail: m }, "p", env.clientId);
    expect(h.items).toHaveLength(1);
  });

  it("shows only this client's chats, in this project", async () => {
    await link();
    await allowChat(env.repos, owner, { project: "p", channel: "telegram_bot", chatId: "200" });
    await say("1", "2026-11-11T10:00:00.000Z", "mine");
    await say("2", "2026-11-11T11:00:00.000Z", "someone else", "200");
    const h = await clientHistory({ repos: env.repos }, "p", env.clientId);
    expect(h.items.map((i) => (i.source === "messenger" ? i.text : ""))).toEqual(["mine"]);
  });

  it("refuses a client of another project and a bad cursor", async () => {
    const other = await env.repos.clients.create({ project: "q", email: "z@q.test", name: "Z" });
    await expect(clientHistory({ repos: env.repos }, "p", other)).rejects.toMatchObject({ code: "not_found" });
    await expect(clientHistory({ repos: env.repos }, "p", env.clientId, { cursor: "garbage" })).rejects.toThrow("bad_cursor");
  });

  it("does not show purged rows", async () => {
    await link();
    await env.repos.messengers.insertMessage({ project: "p", channel: "telegram_bot", account: "1", chatId: "100", remoteMessageId: "old", direction: "in", kind: "text", text: "old", sentAt: "2026-01-01T00:00:00.000Z", retainUntil: "2026-04-01T00:00:00.000Z" });
    await env.repos.messengers.purgeExpired("2026-11-14T00:00:00.000Z");
    expect((await clientHistory({ repos: env.repos }, "p", env.clientId)).items).toEqual([]);
  });
});
