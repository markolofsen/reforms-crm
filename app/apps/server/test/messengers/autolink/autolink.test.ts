import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { FakeLoginClient, FakeMtClient, fakePerson, type MtMessage, type MtPeer } from "@hub/messengers";
import { testApp } from "../../support/runtime";
import { startAutolink, type Autolink } from "../../../src/messengers/autolink/autolink";
import type { ProjectAutolink } from "../../../src/messengers/autolink/setup";
import { entryOf, startClientDirectory, type ClientDirectory } from "../../../src/clients/directory";
import { startTelegramUser, type TelegramUserHandle } from "../../../src/messengers/accounts/telegram-user";

// P84: chats link themselves to client records, on a fake mtcute client and a fake Notion reader. No network, no real session.

const ADMIN = 5173;
const HEADERS = { origin: `http://127.0.0.1:${ADMIN}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const BASE = "http://127.0.0.1:4317";
const HASH = "0123456789abcdef0123456789abcdef";

type Page = { id: string; properties: Record<string, unknown> };
const page = (id: string, name: string, o: { email?: string; phone?: string; telegram?: string; whatsapp?: string; relationship?: string; synthetic?: boolean; dnc?: boolean } = {}): Page => ({
  id,
  properties: {
    Name: { type: "title", title: [{ plain_text: name }] },
    Email: { type: "email", email: o.email ?? null },
    Phone: { type: "phone_number", phone_number: o.phone ?? null },
    ...(o.telegram ? { Telegram: { type: "rich_text", rich_text: [{ plain_text: o.telegram }] } } : {}),
    ...(o.whatsapp ? { WhatsApp: { type: "phone_number", phone_number: o.whatsapp } } : {}),
    Relationship: { type: "select", select: o.relationship ? { name: o.relationship } : null },
    Synthetic: { type: "checkbox", checkbox: o.synthetic ?? false },
    "Do not contact": { type: "checkbox", checkbox: o.dnc ?? false },
  },
});
const reader = (pages: Page[]) => ({
  retrieveDataSource: async () => ({ id: "ds", title: "Clients", properties: {} }),
  async *listPages() {
    for (const p of pages) yield { ...p, last_edited_time: "2026-11-20T00:00:00.000Z" } as never;
  },
  retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
});

const PAGES: Page[] = [
  page("n-anna", "Anna", { email: "anna@example.test", phone: "+62 813 0000 1111", relationship: "Lead" }),
  page("n-bob1", "Bob", { email: "bob@example.test", phone: "+62 813 0000 2222", relationship: "Client" }),
  page("n-bob2", "Bobby", { email: "bobby@example.test", phone: "+62 813 0000 2222", relationship: "Lead" }),
  page("n-noemail", "Carl", { phone: "+62 813 0000 3333" }),
  page("n-test", "Synthetic Sam", { email: "sam@example.test", phone: "+62 813 0000 4444", synthetic: true }),
  page("n-dnc", "Dora", { email: "dora@example.test", phone: "+62 813 0000 5555", dnc: true }),
];
const anna = fakePerson(1001, "Annie (saved name)", { phone: "6281300001111" });
const bob = fakePerson(1002, "Bob B", { phone: "6281300002222" });
const carl = fakePerson(1003, "Carl", { phone: "6281300003333" });
const sam = fakePerson(1004, "Sam", { phone: "6281300004444" });
const nameOnly = fakePerson(1005, "Anna");
const group: MtPeer = { type: "other", id: -100500, displayName: "Anna's group" };

let handle: DbHandle;
let repos: Repos;
let dir: string;
let fake: FakeMtClient;
let tg: TelegramUserHandle | null;
let on: boolean;
let directory: ClientDirectory;
let al: Autolink;

const post = (app: ReturnType<typeof testApp>, path: string, body: unknown = {}, headers: Record<string, string> = HEADERS) => app.request(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const msg = (chat: MtPeer, id: number, text: string): MtMessage => ({ id, date: new Date(Date.now() - 86_400_000), text, mediaType: null, isOutgoing: false, isService: false, chat });

function makeAutolink() {
  return startAutolink({
    repos,
    project: "p",
    directory,
    enabled: async () => on,
    adapterOf: (channel, account) => (channel === "telegram_user" ? tg?.adapter(account) : undefined),
    accounts: () => (tg?.status().accounts ?? []).map((a) => ({ channel: "telegram_user" as const, account: a.account })),
    keyFile: join(dir, "autolink-key"),
  });
}

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  dir = mkdtempSync(join(tmpdir(), "hub-autolink-"));
  fake = new FakeMtClient();
  fake.peers = [anna, bob, carl, sam, nameOnly, group];
  fake.past = [msg(anna, 11, "hello from Anna"), msg(bob, 12, "hi")];
  on = true;
  directory = startClientDirectory({ dataSourceId: "ds", tokenFile: "notion-token", reader: reader(PAGES), auto: false });
  await directory.refresh();
  tg = await startTelegramUser({ repos, env: {}, dir, clients: { session: () => fake, login: () => new FakeLoginClient() }, onUnlinked: (account, d, inbound) => al.seen("telegram_user", account, d, inbound) });
  al = makeAutolink();
  // Sign in through the gated steps, as the owner would.
  const app = testApp(repos, { telegramUser: tg, adminPort: ADMIN });
  const s1 = (await (await post(app, "/api/messengers/telegram-user/login/start", { apiId: 12345, apiHash: HASH, phone: "+62 813 0000 9999" })).json()) as { flow: string };
  await post(app, "/api/messengers/telegram-user/login/code", { flow: s1.flow, code: "12345" });
  await vi.waitFor(() => expect(fake.listening).toBe(true));
});
afterEach(async () => {
  await tg?.stop();
  directory.stop();
  handle.close();
});

const rows = (sql: string) => handle.db.$client.prepare(sql).all();

describe("the client directory (Notion, read only, in memory)", () => {
  it("leaves out Synthetic and Do not contact rows and reads phones with their country code only", () => {
    expect(directory.status()).toMatchObject({ state: "ready", entries: 4, withIdentifier: 4, byRelationship: { Lead: 2, Client: 1, none: 1 } });
    expect(entryOf(page("x", "X", { email: "x@example.test", phone: "0813 0000 1111" }) as never)?.identifiers).toEqual([]);
    expect(entryOf(page("y", "Y", { email: "y@example.test", telegram: "@Anna_Smith" }) as never)?.identifiers).toEqual([{ kind: "username", value: "anna_smith" }]);
  });

  it("reads Phone for both messengers, WhatsApp for WhatsApp only, and a Telegram username or number for Telegram only", () => {
    expect(entryOf(page("z", "Z", { email: "z@example.test", phone: "+62 813 0000 1111", whatsapp: "+62 813 0000 8888", telegram: "t.me/Zed_Z, +62 813 0000 9999" }) as never)?.identifiers).toEqual([
      { kind: "phone", value: "+6281300001111" },
      { kind: "username", value: "zed_z" },
      { kind: "phone", value: "+6281300009999", channel: "telegram" },
      { kind: "phone", value: "+6281300008888", channel: "whatsapp" },
    ]);
    expect(entryOf(page("w", "W", { email: "w@example.test", whatsapp: "0813 0000 8888", telegram: "813 0000 9999" }) as never)?.identifiers).toEqual([]);
  });
});

describe("autolink on the connect scan", () => {
  it("P131 O5: a linked chat keeps its own phone from the link, and a chat linked before gets it on the next scan, never erased", async () => {
    await al.scan("telegram_user", "42");
    await al.idle();
    expect(rows("select chat_id, username, phone from messenger_chats")).toEqual([{ chat_id: "1001", username: null, phone: "6281300001111" }]);
    // A chat the owner linked before this column existed: the scan fills what it sees, and a null never erases a stored value.
    await repos.messengers.allowChat("p", "telegram_user", "1002", "Bob B");
    await al.scan("telegram_user", "42");
    await al.idle();
    expect(rows("select chat_id, phone from messenger_chats order by chat_id")).toEqual([{ chat_id: "1001", phone: "6281300001111" }, { chat_id: "1002", phone: "6281300002222" }]);
    expect(await repos.messengers.setChatIdentity("p", "telegram_user", "1002", { username: null, phone: null })).toBe(false);
    expect(await repos.messengers.setChatIdentity("p", "telegram_user", "1002", { username: "@Bob_B", phone: "" })).toBe(true);
    expect(rows("select username, phone from messenger_chats where chat_id = '1002'")).toEqual([{ username: "Bob_B", phone: "6281300002222" }]);
    expect(await repos.messengers.setChatIdentity("p", "telegram_user", "9999", { username: "nobody" })).toBe(false);
  });

  it("links the one dialog whose phone equals exactly one record: client row, identifier, chat, 30 days imported, one Activity line", async () => {
    await al.scan("telegram_user", "42");
    await al.idle();
    expect(rows("select email, name from clients")).toEqual([{ email: "anna@example.test", name: "Anna" }]);
    expect(rows("select kind, value from client_identifiers")).toEqual([{ kind: "telegram", value: "1001" }]);
    expect(rows("select channel, chat_id, autolinked from messenger_chats")).toEqual([{ channel: "telegram_user", chat_id: "1001", autolinked: "phone matches the client" }]);
    expect(rows("select text from messenger_messages")).toEqual([{ text: "hello from Anna" }]);
    const act = await repos.runs.activity("p");
    expect(act.rows).toHaveLength(1);
    expect(act.rows[0]).toMatchObject({ outcome: "linked", who: "Anna", client: { name: "Anna" } });
    expect(act.rows[0]!.why).toMatch(/Telegram chat, phone matches the client; 1 message of the last 30 days imported\. Next: say "triage messages for Anna"/);
    // Bob's number belongs to two records, Carl's record has no email, Sam is Synthetic, "Anna" matches by name only, the group is never read.
    const st = await al.state();
    expect(st.recent.map((r) => [r.chatId, r.why, r.candidates.length])).toEqual(
      expect.arrayContaining([
        ["1002", "ambiguous", 2],
        ["1003", "no_email", 1],
        ["1004", "none", 0],
        ["1005", "none", 0],
      ]),
    );
    expect(st.recent.some((r) => r.chatId === "-100500")).toBe(false);
  });

  it("links nothing when messengers.autolink is off, and keeps the match as a suggestion in memory only", async () => {
    on = false;
    await al.scan("telegram_user", "42");
    await al.idle();
    expect(rows("select count(*) n from messenger_chats")).toEqual([{ n: 0 }]);
    expect(rows("select count(*) n from clients")).toEqual([{ n: 0 }]);
    expect((await al.state()).recent.find((r) => r.chatId === "1001")).toMatchObject({ why: "off", candidates: [{ key: "n-anna" }] });
  });

  it("the preview counts only and writes nothing", async () => {
    const before = rows("select (select count(*) from clients) c, (select count(*) from messenger_chats) m, (select count(*) from agent_events) e");
    const p = await al.preview();
    expect(p).toEqual([{ channel: "telegram_user", account: "42", dialogs: 5, linked: 0, unique: 1, ambiguous: 1, noEmail: 1, byRelationship: { Lead: 1 } }]);
    expect(rows("select (select count(*) from clients) c, (select count(*) from messenger_chats) m, (select count(*) from agent_events) e")).toEqual(before);
  });
});

describe("autolink on a new inbound message", () => {
  it("an unlinked chat's message leaves no row, and only its identity reaches the matcher", async () => {
    const seen: unknown[] = [];
    const orig = al.seen;
    al = { ...al, seen: (...a) => (seen.push(a[2]), orig(...a)) };
    fake.emit(sam, "a private text that must not be kept");
    await al.idle();
    expect(seen).toEqual([{ chatId: "1004", title: "Sam", phone: "+6281300004444", username: null }]);
    expect(JSON.stringify(seen)).not.toMatch(/private text/);
    expect(rows("select count(*) n from messenger_messages")).toEqual([{ n: 0 }]);
    expect((await al.state()).unlinkedActive).toBe(1);
  });

  it("links a matching chat that writes, then stores its next message", async () => {
    fake.emit(anna, "first message");
    await al.idle();
    expect(rows("select chat_id from messenger_chats")).toEqual([{ chat_id: "1001" }]);
    fake.emit(anna, "second message");
    await vi.waitFor(() => expect(rows("select text from messenger_messages where text = 'second message'")).toHaveLength(1));
  });
});

describe("Unlink and Never link", () => {
  it("Never link unlinks, keeps only a keyed hash, and holds after a restart", async () => {
    await al.scan("telegram_user", "42");
    await al.idle();
    const chat = rows("select id from messenger_chats")[0] as { id: number };
    const linker: ProjectAutolink = { project: null, autolink: al, directory, stop: () => undefined };
    const app = testApp(repos, { telegramUser: tg ?? undefined, autolink: linker, adminPort: ADMIN });
    expect((await post(app, `/api/projects/p/messengers/chats/${chat.id}/never`, {}, { "content-type": "application/json" })).status).toBe(403);
    expect((await post(app, `/api/projects/p/messengers/chats/${chat.id}/never`)).status).toBe(200);
    expect(rows("select count(*) n from messenger_chats")).toEqual([{ n: 0 }]);
    expect(rows("select count(*) n from messenger_messages")).toEqual([{ n: 0 }]);
    expect(rows("select count(*) n from client_identifiers")).toEqual([{ n: 0 }]);
    const refusals = rows("select channel, hash from messenger_link_refusals") as { channel: string; hash: string }[];
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(refusals)).not.toMatch(/1001/);
    expect(statSync(join(dir, "autolink-key")).mode & 0o777).toBe(0o600);
    // A new coordinator (a restart) reads the refusal back and does not link the chat again.
    al = makeAutolink();
    await al.scan("telegram_user", "42");
    await al.idle();
    expect(rows("select count(*) n from messenger_chats")).toEqual([{ n: 0 }]);
  });

  it("Unlink removes the chat and its messages; the state and preview routes need the admin gate", async () => {
    await al.scan("telegram_user", "42");
    await al.idle();
    const chat = rows("select id from messenger_chats")[0] as { id: number };
    const app = testApp(repos, { telegramUser: tg ?? undefined, autolink: { project: null, autolink: al, directory, stop: () => undefined }, adminPort: ADMIN });
    for (const path of ["/api/projects/p/messengers/autolink/state", "/api/projects/p/messengers/autolink/preview"]) {
      expect((await post(app, path, {}, { "content-type": "application/json" })).status).toBe(403);
      expect((await post(app, path)).status).toBe(200);
    }
    const preview = await (await post(app, "/api/projects/p/messengers/autolink/preview")).json();
    expect(JSON.stringify(preview)).not.toMatch(/Anna|1001|6281/);
    expect((await post(app, `/api/projects/p/messengers/chats/${chat.id}/unlink`)).status).toBe(200);
    expect(rows("select count(*) n from messenger_messages")).toEqual([{ n: 0 }]);
    expect(rows("select count(*) n from messenger_link_refusals")).toEqual([{ n: 0 }]);
  });

  it("the owner links a suggested dialog to the record he picks", async () => {
    on = false;
    await al.scan("telegram_user", "42");
    await al.idle();
    const app = testApp(repos, { telegramUser: tg ?? undefined, autolink: { project: null, autolink: al, directory, stop: () => undefined }, adminPort: ADMIN });
    const r = await post(app, "/api/projects/p/messengers/autolink/link", { channel: "telegram_user", account: "42", chatId: "1002", key: "n-bob2", title: "Bob B" });
    expect(r.status).toBe(200);
    expect(rows("select c.email, m.chat_id, m.autolinked from clients c join client_identifiers i on i.client_id = c.id join messenger_chats m on m.chat_id = i.value")).toEqual([{ email: "bobby@example.test", chat_id: "1002", autolinked: null }]);
  });
});
