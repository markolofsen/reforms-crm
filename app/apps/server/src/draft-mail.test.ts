import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDraftWriter } from "@hub/agent/mail-drafts";
import { createRepos, openDb, versionHashOf, type DbHandle, type Repos } from "@hub/db";
import { FakeMailer, mailHash, type MailDraft } from "@hub/send";
import { setSendPolicy } from "@hub/projects";
import { createApp } from "./app";

// P56, P65: the open draft's Mail read (the thread decides, `aside`, `gone`), Restore and Save (each recorded as a Mail
// version), and Skip moving only the versions the Hub recorded to Trash. FakeMailer and FakeDraftWriter only: nothing
// reaches Mail, nothing is sent.

const projectMd = ["# Acme", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | owner@acme.example | 2026-11-14 | agent |", "| mail.addresses | owner@acme.example | 2026-11-14 | owner |", "| mail.sender | owner@acme.example | 2026-11-14 | owner |", "| tone | brief | 2026-11-14 | owner |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", "- reports: 00000000-0000-4000-8000-000000000002", ""].join("\n");
const THREAD = "in1@client.example";
const ADMIN = { "content-type": "application/json", origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" };
const mail = (ref: string, body: string, over: Partial<MailDraft> = {}): MailDraft => ({ ref, messageId: `${ref}@acme.example`, account: "owner@acme.example", inReplyTo: THREAD, sender: "owner@acme.example", to: ["client@example.com"], cc: [], bcc: [], subject: "Re: hello", body, attachments: 0, ...over });
/** A Mail draft the Hub wrote: in Mail, and recorded as a version of the draft. */
const hubs = async (ref: string, text: string) => {
  const m = mail(ref, text);
  await repos.mailVersions.add({ project: "acme", mailRef: THREAD, draftId: id, account: "owner@acme.example", mailId: Number(ref), messageId: m.messageId ?? "", hash: "h", source: "agent" });
  return m;
};

let handle: DbHandle;
let repos: Repos;
let mailer: FakeMailer;
let writer: FakeDraftWriter;
let bumps: string[];
let app: ReturnType<typeof createApp>;
let id: number;
const url = (rest = "") => `http://127.0.0.1:4317/api/projects/acme/drafts/${id}/mail${rest}`;
const get = async () => (await app.request(url())).json() as Promise<Record<string, unknown>>;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "hub-draft-mail-"));
  mkdirSync(join(dir, "projects", "acme"), { recursive: true });
  writeFileSync(join(dir, "projects", "acme", "project.md"), projectMd);
  handle = openDb(join(dir, "app.db"));
  repos = createRepos(handle.db);
  mailer = new FakeMailer();
  writer = new FakeDraftWriter(() => THREAD);
  writer.inbound.set(THREAD, { account: "owner@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
  bumps = [];
  const policyDir = join(dir, "state", "projects");
  setSendPolicy(policyDir, "acme", "generic", { "draft.recipients": "any" }, "test");
  app = createApp(repos, { sender: { kind: "fake", mailer, projectsDir: join(dir, "projects"), policyDir, allowList: [], adminPort: 5173, writer, mailWritten: (p) => bumps.push(p) } });
  id = (await repos.drafts.record({ project: "acme", email: "client@example.com", name: "Cli", subject: "Re: hello", mailRef: `<${THREAD}>`, mailClass: "client" })).draftId;
});
afterEach(() => handle.close());

describe("the Mail read (P56, P65)", () => {
  it("the thread's one draft is the draft, with a hash; another draft of the subject that answers nothing is named, not picked", async () => {
    mailer.drafts.push(await hubs("10", "Hi"), mail("11", "my own, no headers", { inReplyTo: null }));
    const r = await get();
    expect(r).toMatchObject({ found: true, note: null, gone: null, body: "Hi" });
    expect(r.hash).toBeTypeOf("string");
    expect(String(r.aside)).toMatch(/Mail id 11\): left alone/);
  });

  it("two drafts of the thread are shown without a hash, naming which one the Hub wrote", async () => {
    mailer.drafts.push(await hubs("10", "Hi"), mail("11", "my own reply in the thread"));
    const r = await get();
    expect(r).toMatchObject({ found: true, hash: null });
    expect(String(r.note)).toMatch(/Mail id 11 is not the Hub's; Mail id 10 is the Hub's version/);
  });

  // P65 S5 (saas draft 1, 2026-11-19): two saves of the Hub's own text crowded the thread; the read heals it itself.
  it("a second save of the Hub's recorded text is adopted and moved to Trash by the read: one draft, with a hash", async () => {
    const text = "Hi, the sarcasm.";
    const v = mail("20", text);
    await repos.mailVersions.add({ project: "acme", mailRef: THREAD, draftId: id, account: "owner@acme.example", mailId: 20, messageId: v.messageId ?? "", hash: versionHashOf(text), source: "agent" });
    mailer.drafts.push(mail("19", text), v);
    const r = await get();
    expect(r).toMatchObject({ found: true, note: null, body: text });
    expect(r.hash).toBeTypeOf("string");
    expect(mailer.drafts.map((d) => d.ref)).toEqual(["20"]);
    expect((await repos.mailVersions.ofDraft(id)).map((x) => [x.mailId, x.source, x.trashedAt === null])).toEqual([[19, "adopted", false], [20, "agent", true]]);
  });

  it("a read that shows another text than the checked one turns Checked off", async () => {
    mailer.drafts.push(await hubs("10", "Hi"));
    await repos.drafts.setChecked(id, true, "an-older-hash");
    expect(await get()).toMatchObject({ checkedCurrent: false });
    expect((await repos.drafts.get(id))?.checked).toBe(false);
  });

  it("no draft at all is gone, with the newest version the Hub recorded in Trash; the owner's trashed drafts are not offered", async () => {
    mailer.trash.push(await hubs("8", "old"), await hubs("9", "newer"), mail("12", "my own, trashed"));
    expect(await get()).toMatchObject({ found: false, gone: { trashRef: "9" } });
    mailer.trash = [mail("12", "my own, trashed")];
    expect(await get()).toMatchObject({ found: false, gone: { trashRef: null } });
  });
});

describe("Restore and Save (P56, P65)", () => {
  it("Restore writes the recorded Trash copy again through the writer, verbatim, records it, turns Checked off and bumps mail", async () => {
    mailer.trash.push(await hubs("9", "Hi Cli,\n\n> their question"));
    await repos.drafts.setChecked(id, true);
    const res = await app.request(url("/restore"), { method: "POST", headers: ADMIN });
    expect(res.status).toBe(200);
    expect(writer.drafts.map((d) => [d.text, d.quote])).toEqual([["Hi Cli,\n\n> their question", "keep"]]);
    expect((await repos.mailVersions.ofDraft(id))[0]).toMatchObject({ source: "restore", messageId: writer.drafts[0]?.messageId });
    expect((await repos.drafts.get(id))?.checked).toBe(false);
    expect(bumps).toEqual(["acme"]);
  });

  it("Restore refuses when Mail still holds a draft or Trash holds none, and from any page but the admin", async () => {
    expect((await app.request(url("/restore"), { method: "POST", headers: ADMIN })).status).toBe(409);
    mailer.drafts.push(await hubs("10", "Hi"));
    expect((await app.request(url("/restore"), { method: "POST", headers: ADMIN })).status).toBe(409);
    for (const headers of [{ "content-type": "application/json" }, { ...ADMIN, origin: "http://127.0.0.1:3000" }, { ...ADMIN, "sec-fetch-site": "same-site" }]) {
      expect((await app.request(url("/restore"), { method: "POST", headers })).status).toBe(403);
    }
    expect(writer.drafts).toEqual([]);
  });

  it("Save writes the person's text over the very read it was edited from; a stale hash is 409 and writes nothing", async () => {
    const m = await hubs("10", "Hi");
    mailer.drafts.push(m);
    await repos.drafts.setChecked(id, true, mailHash(m));
    const stale = await app.request(url(), { method: "PUT", headers: ADMIN, body: JSON.stringify({ text: "Hi there", hash: "0".repeat(64) }) });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toMatch(/changed in Mail since you started editing/);
    expect(writer.drafts).toEqual([]);
    const ok = await app.request(url(), { method: "PUT", headers: ADMIN, body: JSON.stringify({ text: "Hi there,\n\n> kept  \n\n", hash: mailHash(m) }) });
    expect(ok.status).toBe(200);
    expect(writer.drafts.map((d) => [d.text, d.quote])).toEqual([["Hi there,\n\n> kept", "keep"]]);
    expect((await repos.mailVersions.ofDraft(id)).map((v) => v.source)).toEqual(["save", "agent"]);
    expect((await repos.drafts.get(id))?.checked).toBe(false);
    expect(bumps).toEqual(["acme"]);
    const forged = await app.request(url(), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x", hash: mailHash(m) }) });
    expect(forged.status).toBe(403);
  });

  it("P83: a sent draft is not saved or restored: 409 with the reason, and nothing reaches the writer", async () => {
    const m = await hubs("10", "Hi");
    mailer.drafts.push(m);
    await repos.drafts.markSent(id, { at: "2026-11-19T14:15:38Z", via: "test", messageId: "s1@x" });
    const r = await app.request(url(), { method: "PUT", headers: ADMIN, body: JSON.stringify({ text: "Hi again", hash: mailHash(m) }) });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/was sent .*a sent mail is not revised/);
    expect(writer.drafts).toEqual([]);
  });
});

describe("Skip and Done move the hub's own drafts to Trash (P56, P65)", () => {
  it("Skip trashes the versions the Hub recorded only; the owner's draft in the same thread stays", async () => {
    mailer.drafts.push(await hubs("10", "Hi"), mail("11", "my own"));
    const res = await app.request(`http://127.0.0.1:4317/api/drafts/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: "acme", status: "skipped" }) });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(mailer.trash.map((d) => d.ref)).toEqual(["10"]));
    expect(mailer.drafts.map((d) => d.ref)).toEqual(["11"]);
  });

  it("a failure to trash never fails the status change; Hold moves nothing", async () => {
    mailer.drafts.push(await hubs("10", "Hi"));
    mailer.failTrash = "Mail is not running";
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hold = await app.request(`http://127.0.0.1:4317/api/drafts/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: "acme", status: "hold" }) });
    expect(hold.status).toBe(200);
    const done = await app.request(`http://127.0.0.1:4317/api/drafts/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: "acme", status: "done" }) });
    expect(done.status).toBe(200);
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    expect(mailer.drafts.map((d) => d.ref)).toEqual(["10"]);
    err.mockRestore();
  });
});
