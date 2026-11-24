import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { FakeMtClient, FakeRpcError } from "@hub/messengers";
import { writeSession } from "@hub/messengers/human";
import { setSendPolicy } from "@hub/projects/send-policy";
import { FakeMailer } from "@hub/send/mailer";
import { testApp } from "./support/runtime";
import { startTelegramUser, type TelegramUserHandle } from "../src/messengers/accounts/telegram-user";

// P71 M4: the send door for a messenger draft, on a fake mtcute client (no network, no login, nothing sent anywhere). The
// "Done when" of M4, one test each: test mode refuses an unlisted chat, a chat with no inbound row, over the cap, inside the
// spacing, after the text changed, while Stop sending is on; and a confirmed send goes out once with its `send_log` row.

const projectMd = [
  "# P",
  "",
  "## Settings",
  "",
  "| Field | Value | Answered | By |",
  "|---|---|---|---|",
  "| schema | 1 | 2026-11-14 | agent |",
  "| status | active | 2026-11-15 | agent |",
  "| mail.accounts | owner@p.example | 2026-11-14 | agent |",
  "",
  "## Notion databases",
  "",
  "- clients: 00000000-0000-4000-8000-000000000001",
  "",
].join("\n");

const BASE = "http://127.0.0.1:4317";
const H = { "content-type": "application/json" };
const ADMIN = { ...H, origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" };
const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);

let handle: DbHandle;
let repos: Repos;
let fake: FakeMtClient;
let tg: TelegramUserHandle;
let root: string;
let policyDir: string;
let clock: number;
let clientId: number;

const appWith = (allowList: string[]) =>
  testApp(repos, { telegramUser: tg, adminPort: 5173, sender: { kind: "fake", mailer: new FakeMailer(), projectsDir: join(root, "projects"), policyDir, allowList, adminPort: 5173, now: () => new Date(clock) } });
type App = ReturnType<typeof appWith>;

const url = (id: number) => `${BASE}/api/projects/p/messengers/drafts/${id}/send`;
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const dry = (app: App, id: number) => app.request(url(id), { method: "POST", headers: H, body: JSON.stringify({ apply: false }) });
const ticket = async (app: App, id: number, kind: "mail" | "messenger" = "messenger") =>
  ((await (await app.request(`${BASE}/api/sends/tickets`, { method: "POST", headers: ADMIN, body: JSON.stringify({ project: "p", draftId: id, kind }) })).json()) as { ticket: string }).ticket;
const apply = async (app: App, id: number, confirm: { chatId: string; text: string }, t?: string) =>
  app.request(url(id), { method: "POST", headers: H, body: JSON.stringify({ apply: true, confirm, ticket: t ?? (await ticket(app, id)) }) });

async function link(chatId: string, inbound: boolean) {
  await repos.messengers.knowChat("p", "telegram_user", chatId, { title: `Chat ${chatId}` });
  if (chatId === "1001") await repos.messengers.addIdentifier("p", clientId, "telegram", chatId);
  if (inbound) {
    const sentAt = new Date(T0 - 3_600_000).toISOString();
    await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "42", chatId, remoteMessageId: "1", direction: "in", kind: "text", text: "Is the 28th still on?", sentAt, retainUntil: "2027-01-01T00:00:00.000Z" });
  }
}
const draft = async (chatId = "1001", text = "Yes, the 28th stands.") => (await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId, text, createdBy: "agent" })).id;
const refusedOf = async (r: Response) => {
  expect(r.status).toBe(409);
  return ((await json(r)).refused as string[]).join(" | ");
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "hub-msend-"));
  mkdirSync(join(root, "projects", "p"), { recursive: true });
  writeFileSync(join(root, "projects", "p", "project.md"), projectMd);
  policyDir = join(root, "state", "projects");
  setSendPolicy(policyDir, "p", "generic", { "draft.recipients": "test" }, "test");
  handle = openDb(join(root, "app.db"));
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  clientId = await repos.clients.create({ project: "p", email: "anna@example.test", name: "Anna" });
  const sessions = join(root, "sessions");
  writeSession(sessions, "telegram_user", "42", { apiId: 1, apiHash: "0123456789abcdef0123456789abcdef", session: "S" });
  fake = new FakeMtClient();
  clock = T0;
  tg = await startTelegramUser({ repos, env: {}, dir: sessions, clients: { session: () => fake, login: () => { throw new Error("no login in this test"); } }, now: () => new Date(clock) });
  await vi.waitFor(() => expect(fake.listening).toBe(true));
  await link("1001", true);
});
afterEach(async () => {
  await tg.stop();
  handle.close();
});

describe("the messenger send door (P71 M4)", () => {
  it("dry run says exactly what would go out and sends nothing", async () => {
    const id = await draft();
    const r = await dry(appWith(["telegram:1001"]), id);
    expect(await json(r)).toEqual({ ok: true, dryRun: true, channel: "telegram_user", chatId: "1001", account: "42", to: "Anna", text: "Yes, the 28th stands." });
    expect(fake.sent).toEqual([]);
    expect(await repos.sends.list("p")).toEqual([]);
  });

  it("sends a confirmed draft once, with its send_log row written first, and never a second time", async () => {
    const app = appWith(["telegram:1001"]);
    const id = await draft();
    const r = await apply(app, id, { chatId: "1001", text: "Yes, the 28th stands." });
    expect(r.status).toBe(200);
    const { sendId } = (await json(r)) as { sendId: number };
    expect(fake.sent).toEqual([{ chatId: 1001, text: "Yes, the 28th stands.", id: expect.any(Number) }]);
    expect(await repos.sends.get(sendId)).toMatchObject({ channel: "telegram_user", messengerDraftId: id, draftId: null, status: "sent", actor: "admin", sender: "42", toAddr: "telegram:1001", subject: "Anna", body: "Yes, the 28th stands.", sentMessageId: String(fake.sent[0]!.id) });
    expect(await repos.messengers.getDraft("p", id)).toMatchObject({ status: "sent", confirmedBy: "admin" });
    clock += 60_000;
    expect(await refusedOf(await apply(app, id, { chatId: "1001", text: "Yes, the 28th stands." }))).toMatch(/does not wait any more: it was sent already/);
    expect(fake.sent).toHaveLength(1);
    // Activity's Sends view reads the same rows: the messenger send is there with its channel.
    const list = (await json(await app.request(`${BASE}/api/projects/p/sends`))) as { sends: { channel: string; messengerDraftId: number | null }[] };
    expect(list.sends).toEqual([expect.objectContaining({ channel: "telegram_user", messengerDraftId: id })]);
  });

  it("test mode refuses a chat that is not on allow_list as telegram:<id>", async () => {
    const id = await draft();
    for (const allow of [[], ["anna@example.test"], ["telegram:9999"]]) {
      expect(await refusedOf(await dry(appWith(allow), id))).toMatch(/test mode \(draft.recipients: test\) and telegram:1001 is not on allow_list/);
      expect(await refusedOf(await apply(appWith(allow), id, { chatId: "1001", text: "Yes, the 28th stands." }))).toMatch(/not on allow_list/);
    }
    expect(fake.sent).toEqual([]);
    expect(await repos.sends.list("p")).toEqual([]);
  });

  it("refuses a chat with no inbound message: the hub never makes first contact", async () => {
    await link("1002", false);
    await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "42", chatId: "1002", remoteMessageId: "9", direction: "out", kind: "text", text: "our own", sentAt: new Date(T0).toISOString(), retainUntil: "2027-01-01T00:00:00.000Z" });
    const id = await draft("1002");
    const app = appWith(["telegram:1002"]);
    expect(await refusedOf(await apply(app, id, { chatId: "1002", text: "Yes, the 28th stands." }))).toMatch(/nobody wrote in this chat yet/);
    expect(fake.sent).toEqual([]);
  });

  it("refuses over the daily cap of the account and inside the 20 s spacing", async () => {
    const app = appWith(["telegram:1001"]);
    const first = await draft();
    expect((await apply(app, first, { chatId: "1001", text: "Yes, the 28th stands." })).status).toBe(200);
    clock += 10_000;
    const second = await draft("1001", "And the keys?");
    expect(await refusedOf(await apply(app, second, { chatId: "1001", text: "And the keys?" }))).toMatch(/under 20 seconds ago: wait 10 s/);
    clock += 11_000;
    expect((await apply(app, second, { chatId: "1001", text: "And the keys?" })).status).toBe(200);
    // 28 more sends of this account in the last 24 h fill the cap of 30.
    const raw = handle.db.$client.prepare("insert into send_log (project, channel, mode, status, actor, sender, to_addr, subject, body, created_at) values ('p','telegram_user','manual','sent','admin','42','telegram:1001','Anna','x',?)");
    for (let i = 0; i < 28; i++) raw.run(new Date(T0 - 3_600_000 + i).toISOString());
    clock += 60_000;
    const third = await draft("1001", "One more");
    expect(await refusedOf(await dry(app, third))).toMatch(/sent 30 messages in the last 24 hours, the cap is 30/);
    expect(await refusedOf(await apply(app, third, { chatId: "1001", text: "One more" }))).toMatch(/the cap is 30/);
    expect(fake.sent).toHaveLength(2);
  });

  it("refuses after the text changed since the person read it", async () => {
    const app = appWith(["telegram:1001"]);
    const id = await draft();
    const seen = (await json(await dry(app, id))) as { text: string };
    await repos.messengers.reviseDraft("p", id, "Yes, the 29th stands.");
    expect(await refusedOf(await apply(app, id, { chatId: "1001", text: seen.text }))).toMatch(/the draft changed after you read it/);
    expect(fake.sent).toEqual([]);
    expect(await repos.messengers.getDraft("p", id)).toMatchObject({ status: "draft" });
  });

  it("refuses while Stop sending is on, for the project or every project", async () => {
    const app = appWith(["telegram:1001"]);
    const id = await draft();
    for (const scope of ["p", "*"]) {
      await app.request(`${BASE}/api/projects/${encodeURIComponent(scope)}/sends/stop`, { method: "POST", headers: H });
      expect(await refusedOf(await apply(app, id, { chatId: "1001", text: "Yes, the 28th stands." }))).toMatch(/Stop sending is on/);
      await app.request(`${BASE}/api/projects/${encodeURIComponent(scope)}/sends/resume`, { method: "POST", headers: H });
    }
    expect(fake.sent).toEqual([]);
    expect(await repos.sends.list("p")).toEqual([]);
  });

  it("P112 S2: refuses while the project is paused or archived, read from project.md on every call", async () => {
    const app = appWith(["telegram:1001"]);
    const id = await draft();
    for (const status of ["paused", "archived"]) {
      writeFileSync(join(root, "projects", "p", "project.md"), projectMd.replace("| status | active |", `| status | ${status} |`));
      expect(await refusedOf(await dry(app, id))).toMatch(new RegExp(`project p is ${status}, not active`));
      expect(await refusedOf(await apply(app, id, { chatId: "1001", text: "Yes, the 28th stands." }))).toMatch(/not active/);
    }
    writeFileSync(join(root, "projects", "p", "project.md"), projectMd);
    expect((await apply(app, id, { chatId: "1001", text: "Yes, the 28th stands." })).status).toBe(200);
    expect(fake.sent).toHaveLength(1);
  });

  it("P112 S2: a draft written for one client is refused once its chat belongs to another (Change client)", async () => {
    const app = appWith(["telegram:1001"]);
    const id = (await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId: "1001", text: "Yes, the 28th stands.", createdBy: "agent", clientId })).id;
    const other = await repos.clients.create({ project: "p", email: "bo@example.test", name: "Bo" });
    await repos.messengers.moveIdentifier("p", "telegram", "1001", other);
    expect(await refusedOf(await apply(app, id, { chatId: "1001", text: "Yes, the 28th stands." }))).toMatch(/moved to another client after this draft was written/);
    expect(fake.sent).toEqual([]);
    expect(await repos.sends.list("p")).toEqual([]);
  });

  it("needs the admin's messenger ticket: none, a forged one or a mail ticket for the same id is 403", async () => {
    const app = appWith(["telegram:1001"]);
    const id = await draft();
    const confirm = { chatId: "1001", text: "Yes, the 28th stands." };
    const noTicket = await app.request(url(id), { method: "POST", headers: H, body: JSON.stringify({ apply: true, confirm }) });
    expect(noTicket.status).toBe(403);
    expect((await apply(app, id, confirm, "x".repeat(43))).status).toBe(403);
    expect((await app.request(`${BASE}/api/sends/tickets`, { method: "POST", headers: H, body: JSON.stringify({ project: "p", draftId: id, kind: "messenger" }) })).status).toBe(403);
    expect((await app.request(`${BASE}/api/sends/tickets`, { method: "POST", headers: ADMIN, body: JSON.stringify({ project: "p", draftId: 999, kind: "messenger" }) })).status).toBe(404);
    // A mail draft with the same id gets a mail ticket, which does not open the messenger door.
    const mail = await repos.drafts.record({ project: "p", email: "anna@example.test", name: "Anna", subject: "S", mailRef: "<m@x>", mailClass: "client" });
    expect(mail.draftId).toBe(id);
    const mailTicket = await ticket(app, id, "mail");
    expect(mailTicket).toEqual(expect.any(String));
    expect((await apply(app, id, confirm, mailTicket)).status).toBe(403);
    expect(fake.sent).toEqual([]);
  });

  it("a send Telegram refuses is recorded as failed, the draft waits again, nothing is retried, and a long flood wait parks the account", async () => {
    const app = appWith(["telegram:1001"]);
    const id = await draft();
    fake.sendError = new FakeRpcError(400, "PEER_ID_INVALID");
    const r = await apply(app, id, { chatId: "1001", text: "Yes, the 28th stands." });
    expect(r.status).toBe(500);
    expect(await repos.sends.list("p")).toEqual([expect.objectContaining({ status: "failed", channel: "telegram_user", error: expect.stringMatching(/PEER_ID_INVALID/) })]);
    expect(await repos.messengers.getDraft("p", id)).toMatchObject({ status: "draft", confirmedBy: null });
    fake.sendError = new FakeRpcError(420, "FLOOD_WAIT_7200", 7200);
    clock += 60_000;
    expect((await apply(app, id, { chatId: "1001", text: "Yes, the 28th stands." })).status).toBe(500);
    expect(tg.status().accounts[0]).toMatchObject({ account: "42", state: "parked", parked: "flood_wait" });
    expect(await refusedOf(await dry(app, id))).toMatch(/Telegram account 42 is not connected/);
    expect(fake.sent).toEqual([]);
  });
});
