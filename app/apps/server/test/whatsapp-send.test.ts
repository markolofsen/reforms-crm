import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { FakeBoom, FakeWaSocket, WA_CREDS, WaAuthFiles, waFolderOf } from "@hub/messengers";
import { setSendPolicy } from "@hub/projects/send-policy";
import { FakeMailer } from "@hub/send/mailer";
import { testApp } from "./support/runtime";
import { startWhatsApp, type WhatsAppHandle } from "../src/messengers/accounts/whatsapp";

// P71 M5: the M4 checks for a WhatsApp draft, on a FAKE Baileys socket (no WebSocket, no QR scan, nothing sent anywhere): test
// mode refuses an unlisted chat, a chat with no inbound row, over the cap, inside the spacing, after the text changed, while Stop
// sending is on; and a confirmed send goes out once with its `send_log` row. The door is the one of `messenger-send.test.ts`.

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
let fake: FakeWaSocket;
let wa: WhatsAppHandle;
let root: string;
let policyDir: string;
let clock: number;
let clientId: number;

const appWith = (allowList: string[]) =>
  testApp(repos, { whatsapp: wa, adminPort: 5173, sender: { kind: "fake", mailer: new FakeMailer(), projectsDir: join(root, "projects"), policyDir, allowList, adminPort: 5173, now: () => new Date(clock) } });
type App = ReturnType<typeof appWith>;

const ACCOUNT = "4915100000001";
const ANNA = "+491510000002";
const OTHER = "+491510000003";
const url = (id: number) => `${BASE}/api/projects/p/messengers/drafts/${id}/send`;
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const dry = (app: App, id: number) => app.request(url(id), { method: "POST", headers: H, body: JSON.stringify({ apply: false }) });
const ticket = async (app: App, id: number, kind: "mail" | "messenger" = "messenger") =>
  ((await (await app.request(`${BASE}/api/sends/tickets`, { method: "POST", headers: ADMIN, body: JSON.stringify({ project: "p", draftId: id, kind }) })).json()) as { ticket: string }).ticket;
const apply = async (app: App, id: number, confirm: { chatId: string; text: string }, t?: string) =>
  app.request(url(id), { method: "POST", headers: H, body: JSON.stringify({ apply: true, confirm, ticket: t ?? (await ticket(app, id)) }) });

async function link(chatId: string, inbound: boolean) {
  await repos.messengers.allowChat("p", "whatsapp", chatId, `Chat ${chatId}`);
  if (chatId === ANNA) await repos.messengers.addIdentifier("p", clientId, "whatsapp", chatId);
  if (inbound) {
    const sentAt = new Date(T0 - 3_600_000).toISOString();
    await repos.messengers.insertMessage({ project: "p", channel: "whatsapp", account: ACCOUNT, chatId, remoteMessageId: "3EB0IN1", direction: "in", kind: "text", text: "Is the 28th still on?", sentAt, retainUntil: "2027-01-01T00:00:00.000Z" });
  }
}
const draft = async (chatId = ANNA, text = "Yes, the 28th stands.") => (await repos.messengers.createDraft({ project: "p", channel: "whatsapp", chatId, text, createdBy: "agent" })).id;
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
  const auth = new WaAuthFiles(null);
  auth.set(WA_CREDS, JSON.stringify({ me: { id: `${ACCOUNT}:7@s.whatsapp.net` } }));
  auth.persistTo(waFolderOf(sessions, ACCOUNT));
  clock = T0;
  wa = await startWhatsApp({ repos, env: {}, dir: sessions, sockets: (a) => (fake = new FakeWaSocket(a)), now: () => new Date(clock) });
  await vi.waitFor(() => expect(wa.adapter(ACCOUNT)).toBeDefined());
  await vi.waitFor(() => expect(fake.listening).toBe(true));
  await link(ANNA, true);
});
afterEach(async () => {
  await wa.stop();
  handle.close();
});

describe("the messenger send door for WhatsApp (P71 M5)", () => {
  it("dry run says exactly what would go out and sends nothing", async () => {
    const id = await draft();
    const r = await dry(appWith([`whatsapp:${ANNA}`]), id);
    expect(await json(r)).toEqual({ ok: true, dryRun: true, channel: "whatsapp", chatId: ANNA, account: ACCOUNT, to: "Anna", text: "Yes, the 28th stands." });
    expect(fake.sent).toEqual([]);
    expect(await repos.sends.list("p")).toEqual([]);
  });

  it("sends a confirmed draft once, with its send_log row written first, and never a second time", async () => {
    const app = appWith([`whatsapp:${ANNA}`]);
    const id = await draft();
    const r = await apply(app, id, { chatId: ANNA, text: "Yes, the 28th stands." });
    expect(r.status).toBe(200);
    const { sendId } = (await json(r)) as { sendId: number };
    expect(fake.sent).toEqual([{ chatId: ANNA, text: "Yes, the 28th stands.", id: expect.any(String) }]);
    expect(await repos.sends.get(sendId)).toMatchObject({ channel: "whatsapp", messengerDraftId: id, draftId: null, status: "sent", actor: "admin", sender: ACCOUNT, toAddr: `whatsapp:${ANNA}`, subject: "Anna", body: "Yes, the 28th stands.", sentMessageId: fake.sent[0]!.id });
    expect(await repos.messengers.getDraft("p", id)).toMatchObject({ status: "sent", confirmedBy: "admin" });
    clock += 60_000;
    expect(await refusedOf(await apply(app, id, { chatId: ANNA, text: "Yes, the 28th stands." }))).toMatch(/does not wait any more: it was sent already/);
    expect(fake.sent).toHaveLength(1);
    // Activity's Sends view reads the same rows: the messenger send is there with its channel.
    const list = (await json(await app.request(`${BASE}/api/projects/p/sends`))) as { sends: { channel: string; messengerDraftId: number | null }[] };
    expect(list.sends).toEqual([expect.objectContaining({ channel: "whatsapp", messengerDraftId: id })]);
  });

  it("test mode refuses a chat that is not on allow_list as whatsapp:+<number>", async () => {
    const id = await draft();
    for (const allow of [[], ["anna@example.test"], ["whatsapp:+491519999999"], [`telegram:${ANNA}`], [ANNA]]) {
      expect(await refusedOf(await dry(appWith(allow), id))).toMatch(/test mode \(draft.recipients: test\) and whatsapp:\+491510000002 is not on allow_list/);
      expect(await refusedOf(await apply(appWith(allow), id, { chatId: ANNA, text: "Yes, the 28th stands." }))).toMatch(/not on allow_list/);
    }
    expect(fake.sent).toEqual([]);
    expect(await repos.sends.list("p")).toEqual([]);
  });

  it("refuses a chat with no inbound message: the hub never makes first contact", async () => {
    await link(OTHER, false);
    await repos.messengers.insertMessage({ project: "p", channel: "whatsapp", account: ACCOUNT, chatId: OTHER, remoteMessageId: "3EB0OUT9", direction: "out", kind: "text", text: "our own", sentAt: new Date(T0).toISOString(), retainUntil: "2027-01-01T00:00:00.000Z" });
    const id = await draft(OTHER);
    const app = appWith([`whatsapp:${OTHER}`]);
    expect(await refusedOf(await apply(app, id, { chatId: OTHER, text: "Yes, the 28th stands." }))).toMatch(/nobody wrote in this chat yet/);
    expect(fake.sent).toEqual([]);
  });

  it("refuses over the daily cap of the account and inside the 20 s spacing", async () => {
    const app = appWith([`whatsapp:${ANNA}`]);
    const first = await draft();
    expect((await apply(app, first, { chatId: ANNA, text: "Yes, the 28th stands." })).status).toBe(200);
    clock += 10_000;
    const second = await draft(ANNA, "And the keys?");
    expect(await refusedOf(await apply(app, second, { chatId: ANNA, text: "And the keys?" }))).toMatch(/under 20 seconds ago: wait 10 s/);
    clock += 11_000;
    expect((await apply(app, second, { chatId: ANNA, text: "And the keys?" })).status).toBe(200);
    // 28 more sends of this account in the last 24 h fill the cap of 30.
    const raw = handle.db.$client.prepare("insert into send_log (project, channel, mode, status, actor, sender, to_addr, subject, body, created_at) values ('p','whatsapp','manual','sent','admin','4915100000001','whatsapp:+491510000002','Anna','x',?)");
    for (let i = 0; i < 28; i++) raw.run(new Date(T0 - 3_600_000 + i).toISOString());
    clock += 60_000;
    const third = await draft(ANNA, "One more");
    expect(await refusedOf(await dry(app, third))).toMatch(/sent 30 messages in the last 24 hours, the cap is 30/);
    expect(await refusedOf(await apply(app, third, { chatId: ANNA, text: "One more" }))).toMatch(/the cap is 30/);
    expect(fake.sent).toHaveLength(2);
  });

  it("refuses after the text changed since the person read it", async () => {
    const app = appWith([`whatsapp:${ANNA}`]);
    const id = await draft();
    const seen = (await json(await dry(app, id))) as { text: string };
    await repos.messengers.reviseDraft("p", id, "Yes, the 29th stands.");
    expect(await refusedOf(await apply(app, id, { chatId: ANNA, text: seen.text }))).toMatch(/the draft changed after you read it/);
    expect(fake.sent).toEqual([]);
    expect(await repos.messengers.getDraft("p", id)).toMatchObject({ status: "draft" });
  });

  it("refuses while Stop sending is on, for the project or every project", async () => {
    const app = appWith([`whatsapp:${ANNA}`]);
    const id = await draft();
    for (const scope of ["p", "*"]) {
      await app.request(`${BASE}/api/projects/${encodeURIComponent(scope)}/sends/stop`, { method: "POST", headers: H });
      expect(await refusedOf(await apply(app, id, { chatId: ANNA, text: "Yes, the 28th stands." }))).toMatch(/Stop sending is on/);
      await app.request(`${BASE}/api/projects/${encodeURIComponent(scope)}/sends/resume`, { method: "POST", headers: H });
    }
    expect(fake.sent).toEqual([]);
    expect(await repos.sends.list("p")).toEqual([]);
  });

  it("needs the admin's messenger ticket: none, a forged one or a mail ticket for the same id is 403", async () => {
    const app = appWith([`whatsapp:${ANNA}`]);
    const id = await draft();
    const confirm = { chatId: ANNA, text: "Yes, the 28th stands." };
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

  it("a send WhatsApp refuses is recorded as failed, the draft waits again, nothing is retried, and logged out parks the number", async () => {
    const app = appWith([`whatsapp:${ANNA}`]);
    const id = await draft();
    fake.sendError = new FakeBoom(503);
    const r = await apply(app, id, { chatId: ANNA, text: "Yes, the 28th stands." });
    expect(r.status).toBe(500);
    expect(await repos.sends.list("p")).toEqual([expect.objectContaining({ status: "failed", channel: "whatsapp", error: expect.stringMatching(/whatsapp 503/) })]);
    expect(await repos.messengers.getDraft("p", id)).toMatchObject({ status: "draft", confirmedBy: null });
    fake.sendError = new FakeBoom(401);
    clock += 60_000;
    expect((await apply(app, id, { chatId: ANNA, text: "Yes, the 28th stands." })).status).toBe(500);
    expect(wa.status().accounts[0]).toMatchObject({ account: ACCOUNT, state: "parked", parked: "logged_out" });
    expect(await refusedOf(await dry(app, id))).toMatch(/WhatsApp account 4915100000001 is not connected/);
    expect(fake.sent).toEqual([]);
  });
});
