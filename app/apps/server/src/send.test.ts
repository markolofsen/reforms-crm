import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { chooseMailerKind, FakeMailer, type MailDraft } from "@hub/send";
import { createApp } from "./app";
import { createServerMailer } from "./send/mailer";

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
  "| draft.recipients | any | 2026-11-14 | owner |",
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
let app: ReturnType<typeof createApp>;
const H = { "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) => app.request(`http://127.0.0.1:4317${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = (path: string, body?: unknown) => call("POST", path, body ?? {});

const mailDraft = (over: Partial<MailDraft> = {}): MailDraft => ({
  ref: "501",
  messageId: "d1@acme.example",
  account: "owner@acme.example",
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
  app = createApp(repos, { sender: { kind: "fake", mailer, projectsDir: join(dir, "projects"), allowList: [] } });
});
afterEach(() => handle.close());

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
    const res = await post(sendUrl(id), { apply: true, confirm });
    expect(res.status).toBe(200);
    const { sendId } = (await res.json()) as { sendId: number };
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: ["client@example.com"], subject: "Re: hello" });
    const list = (await (await call("GET", "/api/projects/acme/sends")).json()) as { sends: Array<{ id: number; status: string; actor: string; body: string }>; stopped: string[] };
    expect(list.sends[0]).toMatchObject({ id: sendId, status: "sent", actor: "admin", body: "Hello,\n\nThe price is 100.\n\nAcme" });
    // a second send is refused: the audit row alone stops a repeat
    mailer.drafts.push(mailDraft());
    const again = await post(sendUrl(id), { apply: true, confirm });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { refused: string[] }).refused[0]).toMatch(/already sent/);
    expect(mailer.sent).toHaveLength(1);
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
    const res = await post(sendUrl(id), { apply: true, confirm });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { refused: string[] }).refused.join()).toMatch(/injection_suspected/);
    expect(mailer.sent).toEqual([]);
  });

  it("refuses when what the person saw is not what Mail holds (recipient or subject changed)", async () => {
    const id = await draft();
    const wrongTo = await post(sendUrl(id), { apply: true, confirm: { ...confirm, to: ["someone.else@example.com"] } });
    expect(wrongTo.status).toBe(409);
    expect(((await wrongTo.json()) as { refused: string[] }).refused[0]).toMatch(/changed since you looked/);
    const wrongSubject = await post(sendUrl(id), { apply: true, confirm: { ...confirm, subject: "Re: other" } });
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
    const res = await post(sendUrl(id), { apply: true, confirm });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/Mail is not running/);
    expect((await repos.sends.forDraft(id))[0]).toMatchObject({ status: "failed" });
    expect((await post(sendUrl(id), { apply: true, confirm })).status).toBe(200);
  });

  it("without a Mailer configured nothing can send", async () => {
    const bare = createApp(repos);
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
    const refused = await post(sendUrl(id), { apply: true, confirm });
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
    expect((await post(sendUrl(id), { apply: true, confirm })).status).toBe(200);
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
    expect((await post(sendUrl(id), { apply: true, confirm })).status).toBe(409);
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
    await post(sendUrl(id), { apply: true, confirm });
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
  it("is the real one unless HUB_MAILER is exactly `fake`, and the fake needs a named database", () => {
    expect(chooseMailerKind({})).toBe("mail-app");
    expect(chooseMailerKind({ HUB_MAILER: "" })).toBe("mail-app");
    expect(chooseMailerKind({ HUB_MAILER: "fake", HUB_DB: "/tmp/x.db" })).toBe("fake");
    expect(() => chooseMailerKind({ HUB_MAILER: "fake" })).toThrow(/HUB_DB/);
    expect(() => chooseMailerKind({ HUB_MAILER: "fake", HUB_DB: ":memory:" })).toThrow(/HUB_DB/);
    for (const bad of ["1", "true", "FAKE", "Fake", "real", "fake "]) expect(() => chooseMailerKind({ HUB_MAILER: bad, HUB_DB: "/tmp/x.db" }), bad).toThrow(/HUB_MAILER/);
  });

  it("the database-backed fake offers the database's drafts, sends them to nowhere, and /api/health says which Mailer it is", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-server-fake-"));
    mkdirSync(join(dir, "acme"), { recursive: true });
    writeFileSync(join(dir, "acme", "project.md"), projectMd);
    const { kind, mailer: fake } = createServerMailer(repos, dir, { HUB_MAILER: "fake", HUB_DB: "/tmp/x.db" });
    expect(kind).toBe("fake");
    const r = await repos.drafts.record({ project: "acme", email: "client@example.com", name: "Cli", subject: "Re: hello", mailRef: "<d1@acme.example>", mailClass: "client" });
    await repos.drafts.setChecked(r.draftId, true);
    await handle.db.$client.prepare("update drafts set body = ? where id = ?").run("Hello", r.draftId);
    const a = createApp(repos, { sender: { kind, mailer: fake, projectsDir: dir, allowList: [] } });
    const url = `http://127.0.0.1:4317${sendUrl(r.draftId)}`;
    expect((await a.request(url, { method: "POST", headers: H, body: JSON.stringify({ apply: true, confirm }) })).status).toBe(200);
    expect((await (await a.request("http://127.0.0.1:4317/api/health")).json()) as { mailer: string }).toMatchObject({ mailer: "fake" });
    expect((await (await app.request("http://127.0.0.1:4317/api/health")).json()) as { mailer: string }).toMatchObject({ mailer: "fake" });
    expect((await (await createApp(repos).request("http://127.0.0.1:4317/api/health")).json()) as { mailer: string }).toMatchObject({ mailer: "mail-app" });
  });
});
