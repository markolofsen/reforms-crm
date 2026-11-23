import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { FakeLoginClient, FakeMtClient, fakePerson, type MtMessage, type MtPeer } from "@hub/messengers";
import type { ChatClientWriter } from "@hub/notion/chat-client";
import { testApp } from "../../support/runtime";
import { startAutolink, type Autolink } from "../../../src/messengers/autolink/autolink";
import { startClientDirectory, type ClientDirectory } from "../../../src/clients/directory";
import { startTelegramUser, type TelegramUserHandle } from "../../../src/messengers/accounts/telegram-user";

// P102: Change client keeps the messages and sets the old client's open draft aside (Undo restores both), a hidden chat can be linked,
// and the dialogs route marks the picked client's chat. A fake mtcute client, a fake Notion reader and writer: no network, no real write.

const ADMIN = 5173;
const HEADERS = { origin: `http://127.0.0.1:${ADMIN}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const BASE = "http://127.0.0.1:4317";
const HASH = "0123456789abcdef0123456789abcdef";

type Page = { id: string; last_edited_time: string; properties: Record<string, { type: string; [k: string]: unknown }> };
const page = (id: string, name: string, o: { email?: string; phone?: string; telegram?: string } = {}): Page => ({
  id,
  last_edited_time: "2026-11-21T02:06:08.000Z",
  properties: {
    Name: { type: "title", title: [{ plain_text: name }] },
    Email: { type: "email", email: o.email ?? null },
    Phone: { type: "phone_number", phone_number: o.phone ?? null },
    Telegram: { type: "rich_text", rich_text: o.telegram ? [{ plain_text: o.telegram }] : [] },
    WhatsApp: { type: "phone_number", phone_number: null },
    Relationship: { type: "select", select: { name: "Lead" } },
    Synthetic: { type: "checkbox", checkbox: false },
    "Do not contact": { type: "checkbox", checkbox: false },
  },
});
const SCHEMA = {
  Name: { type: "title" },
  Email: { type: "email" },
  "Other emails": { type: "rich_text" },
  Phone: { type: "phone_number" },
  Telegram: { type: "rich_text" },
  WhatsApp: { type: "phone_number" },
  Relationship: { type: "select", select: { options: [{ name: "Lead" }, { name: "Client" }] } },
  Synthetic: { type: "checkbox" },
  "Do not contact": { type: "checkbox" },
};

/** Notion as the fake sees it: `pages` changes after the directory's read, as when the owner adds a card. */
let pages: Page[];
const filters: unknown[] = [];
const textIn = (p: Page) =>
  Object.values(p.properties)
    .map((v) => (Array.isArray(v[v.type]) ? (v[v.type] as Array<{ plain_text: string }>).map((x) => x.plain_text).join("") : typeof v[v.type] === "string" ? (v[v.type] as string) : ""))
    .join(" ")
    .toLowerCase();
const reader = {
  retrieveDataSource: async () => ({ id: "ds", title: "Clients", properties: SCHEMA }),
  async *listPages() {
    for (const p of pages) yield p as never;
  },
  // The fake applies the `contains` terms of the filter to every text of the page (enough for these cases).
  async findPages(_ds: string, filter: unknown, limit = 10) {
    filters.push(filter);
    const terms = ((filter as { or: Array<Record<string, { contains?: string; equals?: string }>> }).or ?? []).map((f) => Object.values(f).find((x) => typeof x === "object")).map((x) => (x?.contains ?? x?.equals ?? "").toLowerCase());
    return pages.filter((p) => terms.some((t) => t && textIn(p).replace(/[\s\-()]/g, "").includes(t.replace(/[\s\-()]/g, "")))).slice(0, limit) as never;
  },
  retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
};
let writes: { op: string; args: unknown[] }[];
let refuse: boolean;
const writer: ChatClientWriter = {
  async createClient(ds, properties) {
    writes.push({ op: "create", args: [ds, properties] });
    if (refuse) throw Object.assign(new Error("restricted"), { status: 403, code: "restricted_resource" });
    return "new-page";
  },
  async retrievePage(id) {
    return pages.find((p) => p.id === id) as never;
  },
  async fillEmpty(id, property, value) {
    writes.push({ op: "fill", args: [id, property, value] });
  },
};

const evgeniy = fakePerson(2001, "Evgeniy", { username: "suenot" });
const noone = fakePerson(2002, "Nobody Known", { username: "nobody_k" });

let handle: DbHandle;
let repos: Repos;
let dir: string;
let fake: FakeMtClient;
let tg: TelegramUserHandle | null;
let directory: ClientDirectory;
let al: Autolink;
let app: ReturnType<typeof testApp>;

const post = (path: string, body: unknown = {}) => app.request(`${BASE}${path}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
const msg = (chat: MtPeer, id: number, text: string): MtMessage => ({ id, date: new Date(Date.now() - 86_400_000), text, mediaType: null, isOutgoing: false, isService: false, chat });
const rows = (sql: string) => handle.db.$client.prepare(sql).all();

beforeEach(async () => {
  pages = [page("n-ten", "Евгений Тен", { email: "john.ten2397@example.test" }), page("n-anna", "Anna", { email: "anna@example.test", phone: "+62 813 0000 1111" })];
  filters.length = 0;
  writes = [];
  refuse = false;
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  dir = mkdtempSync(join(tmpdir(), "hub-p100-"));
  fake = new FakeMtClient();
  fake.peers = [evgeniy, noone];
  fake.past = [msg(evgeniy, 21, "привет"), msg(evgeniy, 22, "как дела"), msg(noone, 23, "hi")];
  directory = startClientDirectory({ dataSourceId: "ds", tokenFile: "notion-token", reader, writer, auto: false });
  await directory.refresh();
  tg = await startTelegramUser({ repos, env: {}, dir, clients: { session: () => fake, login: () => new FakeLoginClient() }, onUnlinked: (account, d, inbound) => al.seen("telegram_user", account, d, inbound) });
  al = startAutolink({
    repos,
    project: "p",
    directory,
    enabled: async () => false,
    adapterOf: (channel, account) => (channel === "telegram_user" ? tg?.adapter(account) : undefined),
    accounts: () => (tg?.status().accounts ?? []).map((a) => ({ channel: "telegram_user" as const, account: a.account })),
    keyFile: join(dir, "autolink-key"),
  });
  app = testApp(repos, { telegramUser: tg, autolink: { project: "p", autolink: al, directory, stop: () => undefined }, adminPort: ADMIN });
  const s1 = (await (await post("/api/messengers/telegram-user/login/start", { apiId: 12345, apiHash: HASH, phone: "+62 813 0000 9999" })).json()) as { flow: string };
  await post("/api/messengers/telegram-user/login/code", { flow: s1.flow, code: "12345" });
  await vi.waitFor(() => expect(fake.listening).toBe(true));
  await al.scan("telegram_user", "42");
  await al.idle();
});
afterEach(async () => {
  await tg?.stop();
  directory.stop();
  handle.close();
});


const count = (table: string) => (rows(`select count(*) n from ${table}`) as { n: number }[])[0]!.n;
const idOf = async (chatId: string) => (rows(`select id from messenger_chats where chat_id = '${chatId}'`) as { id: number }[])[0]!.id;
const link = (chatId: string, key: string) => post("/api/projects/p/messengers/autolink/link", { channel: "telegram_user", account: "42", chatId, key, title: "t" });

describe("Change client", () => {
  it("moves the chat to another record, keeps its messages, sets the open draft aside, and Undo restores both", async () => {
    expect((await link("2001", "n-ten")).status).toBe(200);
    const messages = count("messenger_messages");
    expect(messages).toBeGreaterThan(0);
    const draft = await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId: "2001", text: "hello", createdBy: "agent" });
    const id = await idOf("2001");
    const r = await post(`/api/projects/p/messengers/chats/${id}/client`, { key: "n-anna" });
    expect(r.status).toBe(200);
    const moved = (await r.json()) as { fromClientId: number; toName: string; skippedDraftId: number | null };
    expect(moved).toMatchObject({ ok: true, toName: "Anna", skippedDraftId: draft.id });
    expect(count("messenger_messages")).toBe(messages);
    expect(rows("select c.email from clients c join client_identifiers i on i.client_id = c.id where i.value = '2001'")).toEqual([{ email: "anna@example.test" }]);
    expect((await repos.messengers.getDraft("p", draft.id))?.status).toBe("discarded");
    expect((await post(`/api/projects/p/messengers/chats/${id}/client`, { key: "n-anna" })).status).toBe(409);

    const u = await post(`/api/projects/p/messengers/chats/${id}/client/undo`, { clientId: moved.fromClientId, draftId: moved.skippedDraftId });
    expect(await u.json()).toEqual({ ok: true, id, draftRestored: true });
    expect(rows("select c.email from clients c join client_identifiers i on i.client_id = c.id where i.value = '2001'")).toEqual([{ email: "john.ten2397@example.test" }]);
    expect((await repos.messengers.getDraft("p", draft.id))?.status).toBe("draft");
    expect(count("messenger_messages")).toBe(messages);
  });

  it("refuses an unlinked chat and a record that is not in the directory", async () => {
    await link("2001", "n-ten");
    const id = await idOf("2001");
    expect((await post(`/api/projects/p/messengers/chats/${id}/client`, { key: "nobody" })).status).toBe(409);
    expect((await post("/api/projects/p/messengers/chats/9999/client", { key: "n-anna" })).status).toBe(404);
  });
});

describe("a hidden chat can be linked", () => {
  it("Link forgets the refusal, so the chat leaves Hidden and Not linked", async () => {
    await post("/api/projects/p/messengers/autolink/hide", { channel: "telegram_user", chatId: "2002" });
    expect(rows("select count(*) n from messenger_link_refusals")).toEqual([{ n: 1 }]);
    expect((await link("2002", "n-anna")).status).toBe(200);
    expect(rows("select count(*) n from messenger_link_refusals")).toEqual([{ n: 0 }]);
    const st = (await (await post("/api/projects/p/messengers/autolink/state")).json()) as { hidden: unknown[]; unlinked: { chatId: string }[] };
    expect(st.hidden).toEqual([]);
    expect(st.unlinked.map((d) => d.chatId)).not.toContain("2002");
  });
});

describe("the dialogs of one account", () => {
  it("marks the chat whose username is one of the record's identifiers first, and the already linked one", async () => {
    pages.push(page("n-evg", "Evgeniy", { email: "suenot@example.test", telegram: "suenot" }));
    await directory.refresh();
    await link("2002", "n-anna");
    const r = await post("/api/projects/p/messengers/autolink/dialogs", { channel: "telegram_user", account: "42", key: "n-evg" });
    const d = ((await r.json()) as { dialogs: { chatId: string; suggested: boolean; linked: boolean }[] }).dialogs;
    expect(d.map((x) => [x.chatId, x.suggested, x.linked])).toEqual([
      ["2001", true, false],
      ["2002", false, true],
    ]);
    expect((await post("/api/projects/p/messengers/autolink/dialogs", { channel: "telegram_user", account: "42", key: "gone" })).status).toBe(409);
  });
});
