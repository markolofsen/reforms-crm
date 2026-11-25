import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { FakeLoginClient, FakeMtClient, fakePerson, type MtMessage, type MtPeer } from "@hub/messengers";
import type { ChatClientWriter } from "@hub/notion/chat-client";
import { AGENT_SEND_HEADER } from "@hub/agent/send-token";
import { testApp } from "../../support/runtime";
import { autolinkRoutes } from "../../../src/messengers/autolink/routes";
import { recordMatches, startAutolink, type Autolink } from "../../../src/messengers/autolink/autolink";
import { startClientDirectory, type ClientDirectory } from "../../../src/clients/directory";
import { startTelegramUser, type TelegramUserHandle } from "../../../src/messengers/accounts/telegram-user";

// P100 (owner, 2026-11-21): the link box finds a client made in Notion a minute ago (a live query besides the copy read at start),
// by name, email, @username or phone; Create makes the card from the chat; Link fills the card's empty Telegram, never a full one.
// A fake mtcute client, a fake Notion reader and a fake writer: no network, no real Notion write.

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

const find = async (q: string) => (await (await post("/api/projects/p/messengers/autolink/records", { q })).json()) as { records: { key: string; name: string; email: string }[]; live: boolean; liveError: string | null };

describe("the link box finds a client made after the directory's read", () => {
  it("asks Notion live, so the page made a minute ago shows by name, email, @username and phone, with its email", async () => {
    // The owner adds the card after the read (the saas case: read 01:54Z, page 02:06Z).
    pages.push(page("n-evg", "Евгений", { email: "suenot@example.test" }));
    const byName = await find("Евгений");
    expect(byName.live).toBe(true);
    expect(byName.records.map((r) => [r.name, r.email])).toEqual([
      ["Евгений Тен", "john.ten2397@example.test"],
      ["Евгений", "suenot@example.test"],
    ]);
    expect((await find("suenot@")).records.map((r) => r.key)).toEqual(["n-evg"]);
    pages.push(page("n-tg", "Telegram Tom", { email: "tom@example.test", telegram: "tom_tg" }));
    expect((await find("@tom_tg")).records.map((r) => r.key)).toEqual(["n-tg"]);
    // A phone typed with other spacing finds the record in memory (identifiers) and in Notion (its last digits).
    expect((await find("+62 8130 000 1111")).records.map((r) => r.key)).toEqual(["n-anna"]);
    expect(JSON.stringify(filters.at(-1))).toContain('"phone_number":{"contains":"0001111"}');
  });

  it("matches identifiers in memory with @ and spacing ignored", () => {
    const e = { key: "k", name: "Z", email: "z@x.test", relationship: null, identifiers: [{ kind: "username" as const, value: "suenot" }, { kind: "phone" as const, value: "+6281300001111" }] };
    expect(recordMatches(e, "@suen")).toBe(true);
    expect(recordMatches(e, "813 0000 1111")).toBe(true);
    expect(recordMatches(e, "1111")).toBe(false);
    expect(recordMatches(e, "q")).toBe(false);
  });

  it("links a live hit and fills its empty Telegram with the chat's username; a filled Telegram is never touched", async () => {
    pages.push(page("n-evg", "Евгений", { email: "suenot@example.test" }));
    await find("Евгений");
    const r = await post("/api/projects/p/messengers/autolink/link", { channel: "telegram_user", account: "42", chatId: "2001", key: "n-evg", title: "Evgeniy" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, chatId: "2001", imported: 2, importError: null, days: 30, notion: "Telegram set to suenot in Notion" });
    expect(writes).toEqual([{ op: "fill", args: ["n-evg", { name: "Telegram", type: "rich_text" }, "suenot"] }]);
    expect(rows("select c.email, i.value from clients c join client_identifiers i on i.client_id = c.id")).toEqual([{ email: "suenot@example.test", value: "2001" }]);

    writes = [];
    pages.push(page("n-full", "Full", { email: "full@example.test", telegram: "someone_else" }));
    await find("Full");
    const r2 = await post("/api/projects/p/messengers/autolink/link", { channel: "telegram_user", account: "42", chatId: "2002", key: "n-full", title: "Nobody Known" });
    expect(((await r2.json()) as { notion: string }).notion).toBe("Telegram is already filled in Notion, kept");
    expect(writes).toEqual([]);
  });
});

describe("Create client from a chat", () => {
  it("makes one card with Name, Email, Relationship Lead and the chat's username, then links the chat to it", async () => {
    const r = await post("/api/projects/p/messengers/autolink/create", { channel: "telegram_user", account: "42", chatId: "2002", title: "Nobody Known", name: "Nobody Known", email: "nobody@example.test" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, imported: 1, days: 30, notion: "Created Nobody Known in Notion with Telegram nobody_k" });
    expect(writes).toEqual([
      {
        op: "create",
        args: [
          "ds",
          {
            Name: { title: [{ type: "text", text: { content: "Nobody Known" } }] },
            Email: { email: "nobody@example.test" },
            Relationship: { select: { name: "Lead" } },
            Telegram: { rich_text: [{ type: "text", text: { content: "nobody_k" } }] },
          },
        ],
      },
    ]);
    // In memory at once: the next search finds it without a Notion read, and the chat is linked.
    expect(al.record("new-page")).toMatchObject({ name: "Nobody Known", email: "nobody@example.test", identifiers: [{ kind: "username", value: "nobody_k" }] });
    expect(rows("select chat_id from messenger_chats")).toEqual([{ chat_id: "2002" }]);
  });

  it("P141 C3: makes a card without an Email when the owner gives none, and the client row is keyed by that card", async () => {
    const r = await post("/api/projects/p/messengers/autolink/create", { channel: "telegram_user", account: "42", chatId: "2002", title: "Nobody Known", name: "Telegram @nobody_k" });
    expect(r.status).toBe(200);
    expect(writes).toEqual([{ op: "create", args: ["ds", { Name: { title: [{ type: "text", text: { content: "Telegram @nobody_k" } }] }, Relationship: { select: { name: "Lead" } }, Telegram: { rich_text: [{ type: "text", text: { content: "nobody_k" } }] } }] }]);
    expect(rows("select c.email, c.name, i.value from clients c join client_identifiers i on i.client_id = c.id")).toEqual([{ email: null, name: "Telegram @nobody_k", value: "2002" }]);
  });

  it("P141 C3: with no email, links the card that already holds the chat's username instead of making a second one", async () => {
    pages.push(page("n-nk", "Nadia K", { telegram: "@nobody_k" }));
    const r = await post("/api/projects/p/messengers/autolink/create", { channel: "telegram_user", account: "42", chatId: "2002", title: "Nobody Known", name: "Nobody Known" });
    expect(((await r.json()) as { notion: string }).notion).toMatch(/^Linked to the existing card of Nadia K/);
    expect(writes.filter((w) => w.op === "create")).toEqual([]);
  });

  it("links to the card that already has the email instead of making a second one", async () => {
    pages.push(page("n-evg", "Евгений", { email: "suenot@example.test" }));
    const r = await post("/api/projects/p/messengers/autolink/create", { channel: "telegram_user", account: "42", chatId: "2001", name: "Evgeniy", email: "suenot@example.test" });
    expect(((await r.json()) as { notion: string }).notion).toBe("Linked to the existing card of Евгений; Telegram set to suenot in Notion");
    expect(writes.map((w) => w.op)).toEqual(["fill"]);
  });

  it("Insert content refused: no card, no link, the fix said", async () => {
    refuse = true;
    const r = await post("/api/projects/p/messengers/autolink/create", { channel: "telegram_user", account: "42", chatId: "2002", name: "Nobody Known", email: "nobody@example.test" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/^Notion did not let the Hub create the client: give the hub integration Insert content/);
    expect(rows("select count(*) n from messenger_chats")).toEqual([{ n: 0 }]);
    expect(rows("select count(*) n from clients")).toEqual([{ n: 0 }]);
  });

  it("refuses without the admin gate and with a bad email", async () => {
    const gate = await app.request(`${BASE}/api/projects/p/messengers/autolink/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "telegram_user", account: "42", chatId: "2002", name: "N", email: "n@example.test" }) });
    expect(gate.status).toBe(403);
    expect((await post("/api/projects/p/messengers/autolink/create", { channel: "telegram_user", account: "42", chatId: "2002", name: "N", email: "not-an-email" })).status).toBe(400);
    expect(writes).toEqual([]);
  });
});

describe("P143: the agent's client_create with no chat", () => {
  const TOKEN = "t".repeat(64);
  let unattended = false;
  const agentPost = (body: unknown) =>
    autolinkRoutes({ repos, autolink: { project: "p", autolink: al, directory, stop: () => undefined }, adminPort: ADMIN, agentToken: TOKEN, agentUnattended: () => unattended }).request(`${BASE}/api/projects/p/messengers/autolink/agent-create`, {
      method: "POST",
      headers: { "content-type": "application/json", [AGENT_SEND_HEADER]: TOKEN },
      body: JSON.stringify(body),
    });
  beforeEach(() => {
    unattended = false;
  });

  it("makes one Clients card with the name, company, Phone and Telegram, and no Hub row (rule 16)", async () => {
    const r = await agentPost({ name: "Ahmed", company: "Qimma Auctions", phone: "+966 54 455 5430", telegram: "@qimma_k" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, chat: null, clientId: null, name: "Ahmed, Qimma Auctions", how: "created", notion: "Created Ahmed, Qimma Auctions in Notion with Phone, Telegram" });
    expect(writes).toEqual([
      {
        op: "create",
        args: [
          "ds",
          {
            Name: { title: [{ type: "text", text: { content: "Ahmed, Qimma Auctions" } }] },
            Phone: { phone_number: "+966544555430" },
            Relationship: { select: { name: "Lead" } },
            Telegram: { rich_text: [{ type: "text", text: { content: "qimma_k" } }] },
          },
        ],
      },
    ]);
    expect(al.record("new-page")).toMatchObject({ name: "Ahmed, Qimma Auctions" });
    expect(rows("select count(*) n from clients")).toEqual([{ n: 0 }]);
  });

  it("looks up every identity first: a card with this phone, or a Hub client with this email, is answered and nothing is made", async () => {
    const card = await agentPost({ name: "Anna", phone: "+62 813 0000 1111" });
    expect(await card.json()).toMatchObject({ chat: null, name: "Anna", how: "existing", notion: "An existing Clients card of Anna; nothing was created" });
    const id = await repos.clients.create({ project: "p", email: "zoe@example.test", name: "Zoe" });
    const hub = await agentPost({ name: "Zoe Z", email: "zoe@example.test", telegram: "zoe_z" });
    expect(await hub.json()).toMatchObject({ chat: null, clientId: id, name: "Zoe", how: "existing" });
    expect(writes).toEqual([]);
  });

  it("refuses a name alone, a number for a name and an unattended instance; nothing is written", async () => {
    expect((await agentPost({ name: "Ahmed" })).status).toBe(400);
    expect((await agentPost({ name: "+966 54 455 5430", phone: "+966 54 455 5430" })).status).toBe(400);
    expect((await agentPost({ chat: 1, name: "Ahmed", phone: "+966 54 455 5430" })).status).toBe(400);
    unattended = true;
    expect((await agentPost({ name: "Ahmed", email: "ahmed@example.test" })).status).toBe(403);
    expect(writes).toEqual([]);
  });
});
