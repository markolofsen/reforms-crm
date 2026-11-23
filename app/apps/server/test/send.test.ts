import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { MailDraft } from "@hub/mail-app/drafts";
import { FakeMailer } from "@hub/send/mailer";
import { testApp } from "./support/runtime";
import { createServerMailer } from "../src/send/mailer";
import { setSendPolicy } from "@hub/projects/send-policy";
import { ticketStore } from "../src/http/admin-gate";

// The admin's Send. Every test uses FakeMailer: nothing here reaches Mail and nothing is ever sent.

const projectMd = [
  "# Acme",
  "",
  "## Settings",
  "",
  "| Field | Value | Answered | By |",
  "|---|---|---|---|",
  "| schema | 1 | 2026-11-14 | agent |",
  "| status | active | 2026-11-15 | agent |",
  "| mail.accounts | owner@acme.example | 2026-11-14 | agent |",
  "| mail.addresses | owner@acme.example | 2026-11-14 | owner |",
  "| mail.sender | owner@acme.example | 2026-11-14 | owner |",
  "| tone | brief | 2026-11-14 | owner |",
  "",
  "## Notion databases",
  "",
  "- clients: 00000000-0000-4000-8000-000000000001",
  "- reports: 00000000-0000-4000-8000-000000000002",
  "",
].join("\n");

let handle: DbHandle;
let repos: Repos;
let mailer: FakeMailer;
let app: ReturnType<typeof testApp>;
let policyDir: string;
const H = { "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) => app.request(`http://127.0.0.1:4317${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = (path: string, body?: unknown) => call("POST", path, body ?? {});
/** The admin page's own request headers (P49 S12): exact origin, same-origin fetch. */
const ADMIN = { ...H, origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" };
const ticketFor = async (a: ReturnType<typeof testApp>, draftId: number, headers: Record<string, string> = ADMIN, project = "acme") =>
  a.request("http://127.0.0.1:4317/api/sends/tickets", { method: "POST", headers, body: JSON.stringify({ project, draftId }) });
/** What the admin's Send does: a ticket, then the apply carrying it. */
async function apply(id: number, body: Record<string, unknown>, a: ReturnType<typeof testApp> = app) {
  const t = (await (await ticketFor(a, id)).json()) as { ticket: string };
  return a.request(`http://127.0.0.1:4317${sendUrl(id)}`, { method: "POST", headers: H, body: JSON.stringify({ apply: true, ...body, ticket: t.ticket }) });
}

const mailDraft = (over: Partial<MailDraft> = {}): MailDraft => ({
  ref: "501",
  messageId: "d1@acme.example",
  account: "owner@acme.example",
  inReplyTo: null,
  sender: "Acme <owner@acme.example>",
  to: ["client@example.com"],
  cc: [],
  bcc: [],
  subject: "Re: hello",
  body: "Hello,\n\nThe price is 100.\n\nAcme",
  attachments: 0,
  ...over,
});

async function draft(o: { checked?: boolean; injection?: boolean } = {}) {
  const r = await repos.drafts.record({ project: "acme", email: "client@example.com", name: "Cli", subject: "Re: hello", mailRef: "<d1@acme.example>", mailClass: "client", injectionSuspected: o.injection ?? false });
  if (o.checked !== false) await repos.drafts.setChecked(r.draftId, true);
  mailer.drafts.push(mailDraft());
  return r.draftId;
}
const sendUrl = (id: number, project = "acme") => `/api/projects/${project}/drafts/${id}/send`;
const confirm = { to: ["client@example.com"], subject: "Re: hello" };

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "hub-server-send-"));
  mkdirSync(join(dir, "projects", "acme"), { recursive: true });
  writeFileSync(join(dir, "projects", "acme", "project.md"), projectMd);
  handle = openDb(join(dir, "app.db"));
  repos = createRepos(handle.db);
  mailer = new FakeMailer();
  policyDir = join(dir, "state", "projects");
  setSendPolicy(policyDir, "acme", "generic", { "draft.recipients": "any" }, "test");
  app = testApp(repos, { sender: { kind: "fake", mailer, projectsDir: join(dir, "projects"), policyDir, allowList: [], adminPort: 5173 } });
});
afterEach(() => handle.close());

describe("the send ticket (P49 S12)", () => {
  it("an apply without a ticket is 403 and sends nothing, even with the right recipients and subject", async () => {
    const id = await draft();
    const res = await post(sendUrl(id), { apply: true, confirm });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("forbidden");
    const forged = await post(sendUrl(id), { apply: true, confirm, ticket: "x".repeat(43) });
    expect(forged.status).toBe(403);
    expect(mailer.sent).toEqual([]);
    expect(await repos.sends.forDraft(id)).toEqual([]);
  });
  it("only the admin's exact origin, from a same-origin fetch, gets a ticket", async () => {
    const id = await draft();
    for (const headers of [H, { ...ADMIN, origin: "http://127.0.0.1:3000" }, { ...ADMIN, origin: "http://localhost:5174" }, { ...ADMIN, origin: "null" }, { ...ADMIN, "sec-fetch-site": "same-site" }, { origin: ADMIN.origin, "content-type": "application/json" }]) {
      expect((await ticketFor(app, id, headers)).status, JSON.stringify(headers)).toBe(403);
    }
    expect((await ticketFor(app, id, { ...ADMIN, origin: "http://localhost:5173" })).status).toBe(200);
    expect((await ticketFor(app, 999)).status).toBe(404);
    expect((await ticketFor(app, id, ADMIN, "other")).status).toBe(404);
  });
  it("a ticket is single use, bound to its draft, and expires", async () => {
    const id = await draft();
    const t = ((await (await ticketFor(app, id)).json()) as { ticket: string }).ticket;
    const other = await repos.drafts.record({ project: "acme", email: "b@example.com", name: "B", subject: "Re: b", mailRef: "<b@x>" });
    expect((await post(sendUrl(other.draftId), { apply: true, confirm, ticket: t })).status).toBe(403);
    // the wrong use spent it
    expect((await post(sendUrl(id), { apply: true, confirm, ticket: t })).status).toBe(403);
    let clock = 0;
    const store = ticketStore({ ttlMs: 60_000, now: () => clock });
    const old = store.mint("send:1");
    clock = 60_001;
    expect(store.take(old.ticket, "send:1")).toBe(false);
    const fresh = store.mint("send:1");
    expect(store.take(fresh.ticket, "send:1")).toBe(true);
    expect(store.take(fresh.ticket, "send:1")).toBe(false);
    expect(mailer.sent).toEqual([]);
  });
});

describe("Send from the admin", () => {
  it("a dry run returns the exact mail and sends and writes nothing", async () => {
    const id = await draft();
    const res = await post(sendUrl(id), { apply: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, dryRun: true, to: ["client@example.com"], subject: "Re: hello", body: expect.stringContaining("The price is 100"), from: "Acme <owner@acme.example>" });
    expect(mailer.sent).toEqual([]);
    expect(await repos.sends.forDraft(id)).toEqual([]);
  });

  it("a confirmed send goes out once, writes the audit row by `admin`, and the list shows it", async () => {
    const id = await draft();
    const res = await apply(id, { confirm });
    expect(res.status).toBe(200);
    const { sendId } = (await res.json()) as { sendId: number };
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: ["client@example.com"], subject: "Re: hello" });
    const list = (await (await call("GET", "/api/projects/acme/sends")).json()) as { sends: Array<{ id: number; status: string; actor: string; body: string }>; stopped: string[] };
    expect(list.sends[0]).toMatchObject({ id: sendId, status: "sent", actor: "admin", body: "Hello,\n\nThe price is 100.\n\nAcme" });
    // a second send is refused: the audit row alone stops a repeat
    mailer.drafts.push(mailDraft());
    const again = await apply(id, { confirm });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { refused: string[] }).refused[0]).toMatch(/already sent/);
    expect(mailer.sent).toHaveLength(1);
  });

  it("P65: exactly the Mail text goes out, as a reply to the message the draft answers; the thread's one draft is found by its headers", async () => {
    const r = await repos.drafts.record({ project: "acme", email: "client@example.com", name: "Cli", subject: "Re: hello", mailRef: "<In1@Client.example>", mailClass: "client" });
    await repos.drafts.setChecked(r.draftId, true);
    const m = mailDraft({ ref: "601", messageId: "V601@acme.example", inReplyTo: "in1@client.example", body: "Hello,\n\n> their question" });
    await repos.mailVersions.add({ project: "acme", mailRef: "<In1@Client.example>", draftId: r.draftId, account: "owner@acme.example", mailId: 601, messageId: "V601@acme.example", hash: "h", source: "agent" });
    mailer.drafts.push(m);
    const preview = (await (await post(sendUrl(r.draftId), { apply: false })).json()) as { body: string };
    expect(preview.body).toBe("Hello,\n\n> their question");
    expect((await apply(r.draftId, { confirm })).status).toBe(200);
    expect(mailer.sent[0]?.body).toBe("Hello,\n\n> their question");
    expect(mailer.replies).toEqual(["<In1@Client.example>"]);
    await vi.waitFor(async () => expect((await repos.mailVersions.ofDraft(r.draftId))[0]?.trashedAt).not.toBeNull());
  });

  it("P65: two drafts of the thread refuse the send and name both", async () => {
    const r = await repos.drafts.record({ project: "acme", email: "client@example.com", name: "Cli", subject: "Re: hello", mailRef: "<In1@Client.example>", mailClass: "client" });
    await repos.drafts.setChecked(r.draftId, true);
    mailer.drafts.push(mailDraft({ ref: "601", inReplyTo: "in1@client.example" }), mailDraft({ ref: "602", messageId: "own@acme.example", inReplyTo: "in1@client.example" }));
    const two = await apply(r.draftId, { confirm });
    expect(two.status).toBe(409);
    expect(((await two.json()) as { refused: string[] }).refused.join(" ")).toMatch(/Mail holds 2 drafts that answer this message \(Mail id 602 is not the Hub's; Mail id 601 is not the Hub's\)/);
    expect(mailer.sent).toEqual([]);
  });

  it("refuses with every reason: not Checked, and a placeholder left", async () => {
    const id = await draft({ checked: false });
    mailer.drafts[0] = mailDraft({ body: "Hello [Owner: add the price]" });
    const res = await post(sendUrl(id), { apply: false });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; refused: string[] };
    expect(body.code).toBe("wrong_state");
    expect(body.refused.join("|")).toMatch(/not Checked/);
    expect(body.refused.join("|")).toMatch(/placeholder/);
  });

  it("refuses an injection-suspected draft even when Checked", async () => {
    const id = await draft({ injection: true });
    const res = await apply(id, { confirm });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { refused: string[] }).refused.join()).toMatch(/injection_suspected/);
    expect(mailer.sent).toEqual([]);
  });

  it("refuses when what the person saw is not what Mail holds (recipient or subject changed)", async () => {
    const id = await draft();
    const wrongTo = await apply(id, { confirm: { ...confirm, to: ["someone.else@example.com"] } });
    expect(wrongTo.status).toBe(409);
    expect(((await wrongTo.json()) as { refused: string[] }).refused[0]).toMatch(/changed since you looked/);
    const wrongSubject = await apply(id, { confirm: { ...confirm, subject: "Re: other" } });
    expect(wrongSubject.status).toBe(409);
    expect(mailer.sent).toEqual([]);
  });

  it("a send needs the confirmation in the body: apply true alone is a 400", async () => {
    const id = await draft();
    expect((await post(sendUrl(id), { apply: true })).status).toBe(400);
    expect((await post(sendUrl(id), {})).status).toBe(400);
    expect(mailer.sent).toEqual([]);
  });

  it("a draft of another project is not found", async () => {
    const id = await draft();
    expect((await post(sendUrl(id, "other"), { apply: false })).status).toBe(404);
    expect((await post(sendUrl(9999), { apply: false })).status).toBe(404);
  });

  it("a Mail failure is a 500 with the sentence, the row is failed, and the draft can be sent again", async () => {
    const id = await draft();
    mailer.failSend = "Mail is not running";
    const res = await apply(id, { confirm });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/Mail is not running/);
    expect((await repos.sends.forDraft(id))[0]).toMatchObject({ status: "failed" });
    expect((await apply(id, { confirm })).status).toBe(200);
  });

  it("without a Mailer configured nothing can send", async () => {
    const bare = testApp(repos);
    const id = await draft();
    const res = await bare.request(`http://127.0.0.1:4317${sendUrl(id)}`, { method: "POST", headers: H, body: JSON.stringify({ apply: false }) });
    expect(res.status).toBe(409);
    expect(mailer.sent).toEqual([]);
  });
});

describe("the mail read on demand and Send joining draft state (P27)", () => {
  const mailUrl = (id: number) => `/api/projects/acme/drafts/${id}/mail`;
  const checkedUrl = (id: number) => `/api/drafts/${id}/checked`;

  it("reads the live mail with its hash and checks, writes nothing, and says why when Mail has no such draft", async () => {
    const id = await draft({ checked: false });
    const res = await call("GET", mailUrl(id));
    const mail = (await res.json()) as { found: boolean; hash: string; body: string; to: string[]; safetyResults: unknown[] };
    expect(mail).toMatchObject({ found: true, to: ["client@example.com"], body: expect.stringContaining("The price is 100") });
    expect(mail.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(mail.safetyResults)).toBe(true);
    expect(await repos.sends.forDraft(id)).toEqual([]);
    mailer.drafts.length = 0;
    expect(await (await call("GET", mailUrl(id))).json()).toMatchObject({ configured: true, found: false, reason: expect.stringMatching(/no draft in Mail/), hash: null });
    expect((await call("GET", mailUrl(id).replace("acme", "other"))).status).toBe(404);
  });

  it("Checked binds to the text read: a stale hash is refused, and an edit in Mail after Checked stops the send", async () => {
    const id = await draft({ checked: false });
    const { hash } = (await (await call("GET", mailUrl(id))).json()) as { hash: string };
    const stale = await post(checkedUrl(id), { project: "acme", checked: true, hash: "0".repeat(64) });
    expect(stale.status).toBe(409);
    expect((await post(checkedUrl(id), { project: "acme", checked: true, hash })).status).toBe(200);
    expect((await repos.drafts.get(id))?.checkedHash).toBe(hash);
    mailer.drafts[0] = mailDraft({ body: "Hello,\n\nThe price is 999.\n\nAcme" });
    const refused = await apply(id, { confirm });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { refused: string[] }).refused.join(" ")).toMatch(/changed in Mail after it was Checked/);
    expect(mailer.sent).toEqual([]);
    expect((await repos.drafts.get(id))?.checked).toBe(false);
  });

  it("Checked cannot be switched on for a draft Mail cannot show: no text, no hash, no tick", async () => {
    const id = await draft({ checked: false });
    mailer.drafts.length = 0;
    const refused = await post(checkedUrl(id), { project: "acme", checked: true });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/cannot be checked/);
    expect((await repos.drafts.get(id))?.checked).toBe(false);
    // switching off is never refused
    expect((await post(checkedUrl(id), { project: "acme", checked: false })).status).toBe(200);
  });

  it("a hub send closes the draft as sent, by the hub", async () => {
    const id = await draft();
    expect((await apply(id, { confirm })).status).toBe(200);
    expect(await repos.drafts.get(id)).toMatchObject({ status: "sent", sentVia: "hub" });
  });
});

describe("history, cancel, Stop all", () => {
  it("cancels a queued send inside the window; a sent or unknown one is refused", async () => {
    const id = await draft();
    const queued = await repos.sends.begin({ project: "acme", draftId: id, mode: "auto", status: "queued", actor: "auto", dueAt: new Date(Date.now() + 600_000).toISOString(), to: "client@example.com", subject: "Re: hello", body: "x" });
    expect((await post(`/api/sends/${queued.id}/cancel?project=other`)).status).toBe(404);
    const res = await post(`/api/sends/${queued.id}/cancel?project=acme`);
    expect(res.status).toBe(200);
    expect((await repos.sends.get(queued.id))?.status).toBe("cancelled");
    expect((await post(`/api/sends/${queued.id}/cancel?project=acme`)).status).toBe(409);
    expect((await post(`/api/sends/9999/cancel?project=acme`)).status).toBe(404);
  });

  it("Stop all cancels the queued rows and blocks sends until Resume; `*` is every project", async () => {
    const id = await draft();
    await repos.sends.begin({ project: "acme", draftId: id, mode: "auto", status: "queued", actor: "auto", dueAt: new Date(Date.now() + 600_000).toISOString(), to: "client@example.com", subject: "Re: hello", body: "x" });
    const stop = await post("/api/projects/acme/sends/stop");
    expect(await stop.json()).toMatchObject({ ok: true, cancelled: 1, stopped: ["acme"] });
    const blocked = await post(sendUrl(id), { apply: false });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { refused: string[] }).refused.join()).toMatch(/Stop all is on/);
    expect((await apply(id, { confirm })).status).toBe(409);
    expect(mailer.sent).toEqual([]);
    const resumed = await post("/api/projects/acme/sends/resume");
    expect(await resumed.json()).toMatchObject({ stopped: [] });
    expect((await post(sendUrl(id), { apply: false })).status).toBe(200);
    expect(await (await post("/api/projects/*/sends/stop")).json()).toMatchObject({ stopped: ["*"] });
    expect((await post(sendUrl(id), { apply: false })).status).toBe(409);
  });

  it("the drafts list carries injectionSuspected, mailClass and the live send", async () => {
    const id = await draft();
    const list = async () => ((await (await call("GET", "/api/drafts?project=acme")).json()) as { drafts: Array<{ id: number; injectionSuspected: boolean; mailClass: string | null; sendState: { status: string } | null }> }).drafts[0];
    expect(await list()).toMatchObject({ id, injectionSuspected: false, mailClass: "client", sendState: null });
    await apply(id, { confirm });
    expect((await list())?.sendState).toMatchObject({ status: "sent" });
  });
});

describe("project health (doctor)", () => {
  // A present Notion token leaves the databases check skipped; the token comes from the environment so the test does not read a real secrets folder.
  beforeEach(() => { vi.stubEnv("NOTION_TOKEN", "fake-token-for-the-doctor-test"); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it("returns the doctor's checks for a project with a project.md, and `absent` for one without", async () => {
    const ok = (await (await call("GET", "/api/project/doctor?project=acme")).json()) as { state: string; checks: Array<{ name: string; outcome: string }> };
    expect(ok.state).toBe("ok");
    expect(ok.checks.find((c) => c.name === "project.md parses")?.outcome).toBe("pass");
    expect(ok.checks.find((c) => c.name === "send settings")?.outcome).toBe("pass");
    // checks that need Mail.app or Notion are not run by the server
    expect(ok.checks.find((c) => c.name === "notion databases readable")?.outcome).toBe("skipped");
    expect(await (await call("GET", "/api/project/doctor?project=nope")).json()).toEqual({ state: "absent", checks: [], facts: null });
  });
});

describe("which Mailer the server uses", () => {
  it("the database-backed fake offers the database's drafts, sends them to nowhere, and /api/health says which Mailer it is", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-server-fake-"));
    mkdirSync(join(dir, "acme"), { recursive: true });
    writeFileSync(join(dir, "acme", "project.md"), projectMd);
    const { kind, mailer: fake } = createServerMailer(repos, dir, "fake");
    expect(kind).toBe("fake");
    const r = await repos.drafts.record({ project: "acme", email: "client@example.com", name: "Cli", subject: "Re: hello", mailRef: "<d1@acme.example>", mailClass: "client" });
    await repos.drafts.setChecked(r.draftId, true);
    await handle.db.$client.prepare("update drafts set body = ? where id = ?").run("Hello", r.draftId);
    const pol = join(dir, "..", `${join(dir).split("/").pop()}-policy`);
    setSendPolicy(pol, "acme", "generic", { "draft.recipients": "any" }, "test");
    const a = testApp(repos, { sender: { kind, mailer: fake, projectsDir: dir, policyDir: pol, allowList: [], adminPort: 5173 } });
    expect((await apply(r.draftId, { confirm }, a)).status).toBe(200);
    expect((await (await a.request("http://127.0.0.1:4317/api/health")).json()) as { mailer: string }).toMatchObject({ mailer: "fake" });
    expect((await (await app.request("http://127.0.0.1:4317/api/health")).json()) as { mailer: string }).toMatchObject({ mailer: "fake" });
    expect((await (await testApp(repos).request("http://127.0.0.1:4317/api/health")).json()) as { mailer: string }).toMatchObject({ mailer: "mail-app" });
  });
});
