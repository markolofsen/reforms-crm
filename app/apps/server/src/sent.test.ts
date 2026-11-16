import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { buildEml, FakeImapServer } from "@hub/mail/imap";
import { createApp } from "./app";
import { createMailService } from "./mail";
import { reconcileProject, startSentReconciler } from "./sent";

const ME = "me@example.test";
const ANNA = "anna@example.test";
const SECRET = "hunter2-secret-pass";
let handle: DbHandle;
let repos: Repos;
let dir: string;
let imap: FakeImapServer;
const NOW = new Date("2026-11-14T12:00:00Z");

const login = (name = "Google") => {
  const f = join(dir, `mail-${name}.json`);
  writeFileSync(f, JSON.stringify({ account: name, host: "imap.example.test", user: ME, pass: SECRET }));
  chmodSync(f, 0o600);
};
const register = (over: { accounts?: string[]; status?: string; slug?: string } = {}) =>
  repos.projects.replaceRegistry({
    projects: [{ slug: over.slug ?? "p", name: "P", status: (over.status ?? "active") as "active", settingsJson: JSON.stringify({ mail: { accounts: over.accounts ?? ["Google"], addresses: [ME] } }), hash: "h" }],
    addresses: [],
  });
const mail = () => createMailService({ repos, env: {}, configDir: dir, connect: imap.connect });

/** A client with one open bulk-batch draft to them, subject "Bulk hello". */
async function bulkDraft(email = ANNA, subject = "Bulk hello") {
  const c = await repos.clients.create({ project: "p", email, name: email.split("@")[0]!, lastContactAt: "2026-09-01T00:00:00.000Z" });
  const b = await repos.batches.create({ project: "p", name: "B", intent: "follow_up", audience: "silent", silentDays: 14, brief: "Say hello.", clientIds: [c] }, { now: NOW });
  await repos.batches.addAgentDraft("p", b.batchId, { clientId: c, subject, body: "Hi there", reason: "Silent for a while." });
  const [d] = await repos.batches.drafts("p", b.batchId);
  return d!;
}

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  dir = mkdtempSync(join(tmpdir(), "hub-sent-"));
  imap = new FakeImapServer({ Google: { INBOX: { messages: [] }, Sent: { specialUse: "\\Sent", messages: [] } } });
});
afterEach(() => handle.close());

const sentAt = (subject: string, to: string, date: string, id: string) => imap.add("Google", "Sent", buildEml({ from: ME, to, subject, messageId: id, date }));
const statusOf = async (id: number) => (await repos.drafts.get(id))!;

describe("reconcileProject", () => {
  it("also marks a draft a session recorded (no batch)", async () => {
    login();
    await register();
    const r = await repos.drafts.record({ project: "p", email: ANNA, name: "Anna", subject: "Recorded hello", mailRef: "<rec1@x>" });
    expect((await repos.drafts.get(r.draftId))!.batchId).toBeNull();
    sentAt("Recorded hello", ANNA, new Date(Date.now() + 60_000).toISOString(), "<sent-rec@x>");
    const out = await reconcileProject({ repos, mail: mail(), project: "p", now: new Date(), lookbackDays: 30 });
    expect(out).toMatchObject({ checked: 1, marked: 1 });
    expect(await statusOf(r.draftId)).toMatchObject({ status: "sent", sentMessageId: "<sent-rec@x>" });
  });

  it("marks a draft sent only after its message appears in the Sent folder", async () => {
    login();
    await register();
    const d = await bulkDraft();
    const m = mail();
    expect((await reconcileProject({ repos, mail: m, project: "p", now: new Date(), lookbackDays: 30 })).marked).toBe(0);
    expect((await statusOf(d.id)).status).toBe("ready");

    sentAt("Bulk hello", ANNA, new Date(Date.now() + 60_000).toISOString(), "<sent1@x>");
    const r = await reconcileProject({ repos, mail: m, project: "p", now: new Date(), lookbackDays: 30 });
    expect(r).toMatchObject({ checked: 1, marked: 1, errors: [] });
    expect(await statusOf(d.id)).toMatchObject({ status: "sent", sentVia: "subject-recipient", sentMessageId: "<sent1@x>" });

    // a second pass has nothing waiting and opens no connection
    const before = imap.connects.length;
    expect((await reconcileProject({ repos, mail: m, project: "p", now: new Date(), lookbackDays: 30 })).checked).toBe(0);
    expect(imap.connects.length).toBe(before);
  });

  it("does not mark on someone else's mail, another subject, or a send from before the draft; all reads, no writes", async () => {
    login();
    await register();
    const d = await bulkDraft();
    const future = new Date(Date.now() + 60_000).toISOString();
    sentAt("Another subject", ANNA, future, "<o1@x>");
    sentAt("Bulk hello", "someone.else@example.test", future, "<o2@x>");
    sentAt("Bulk hello", ANNA, "2020-01-01T00:00:00Z", "<o3@x>");
    const r = await reconcileProject({ repos, mail: mail(), project: "p", now: new Date(), lookbackDays: 30 });
    expect(r.marked).toBe(0);
    expect((await statusOf(d.id)).status).toBe("ready");
    expect(imap.ops.every((o) => /:(list|search|headers|close):/.test(o) || o.endsWith(":close:"))).toBe(true);
  });

  it("marks a draft the person already pressed Done on, but never a skipped one", async () => {
    login();
    await register();
    const done = await bulkDraft(ANNA, "One");
    const skipped = await bulkDraft("bob@example.test", "Two");
    await repos.drafts.setStatus(done.id, "done");
    await repos.drafts.setStatus(skipped.id, "skipped");
    const future = new Date(Date.now() + 60_000).toISOString();
    sentAt("One", ANNA, future, "<d1@x>");
    sentAt("Two", "bob@example.test", future, "<d2@x>");
    await reconcileProject({ repos, mail: mail(), project: "p", now: new Date(), lookbackDays: 30 });
    expect((await statusOf(done.id)).status).toBe("sent");
    expect((await statusOf(skipped.id)).status).toBe("skipped");
  });

  it("reports an unreadable account without echoing the login, and marks nothing", async () => {
    login();
    await register();
    const d = await bulkDraft();
    imap.refuse.set("Google", `AUTH failed ${SECRET}`);
    const r = await reconcileProject({ repos, mail: mail(), project: "p", now: new Date(), lookbackDays: 30 });
    expect(r.marked).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).not.toContain(SECRET);
    expect((await statusOf(d.id)).status).toBe("ready");
  });
});

describe("startSentReconciler and /api/health", () => {
  it("is off without a login file, makes no connection, and health says why", async () => {
    await register();
    await bulkDraft();
    const m = mail();
    const h = startSentReconciler({ repos, mail: m, env: {}, timer: false });
    await h.tick();
    expect(h.status()).toMatchObject({ state: "off", marked: 0 });
    expect(h.status().reason).toMatch(/no active project has a mail login/);
    expect(imap.connects).toEqual([]);
    const body = (await (await createApp(repos, { sent: h.status, mail: m }).request("http://127.0.0.1:4317/api/health")).json()) as { sent: { state: string }; mail: { state: string; reason: string } };
    expect(body.sent.state).toBe("off");
    expect(body.mail).toMatchObject({ state: "off", reason: "no mail login file" });
  });

  it("only reads a project's own accounts: a login nobody lists is never opened", async () => {
    login("Other");
    await register({ accounts: ["Google"] });
    await bulkDraft();
    const h = startSentReconciler({ repos, mail: mail(), env: {}, timer: false });
    await h.tick();
    expect(h.status().state).toBe("off");
    expect(imap.connects).toEqual([]);
  });

  it("is off for HUB_SENT=off, and skips a project that is not active", async () => {
    login();
    await register();
    await bulkDraft();
    const off = startSentReconciler({ repos, mail: mail(), env: { HUB_SENT: "off" }, timer: false });
    await off.tick();
    expect(off.status()).toMatchObject({ state: "off", reason: "HUB_SENT=off" });
    await register({ status: "paused" });
    const paused = startSentReconciler({ repos, mail: mail(), env: {}, timer: false });
    await paused.tick();
    expect(paused.status().state).toBe("off");
    expect(imap.connects).toEqual([]);
  });

  it("runs, marks, and reports running with the count; then reports an error and recovers", async () => {
    login();
    await register();
    const d = await bulkDraft();
    sentAt("Bulk hello", ANNA, new Date(Date.now() + 60_000).toISOString(), "<s@x>");
    const m = mail();
    const h = startSentReconciler({ repos, mail: m, env: {}, timer: false, now: () => new Date() });
    await h.tick();
    expect(h.status()).toMatchObject({ state: "running", projects: ["p"], marked: 1, failures: 0 });
    expect(h.status().lastRunAt).toBeTruthy();
    expect((await statusOf(d.id)).status).toBe("sent");

    await bulkDraft("bob@example.test", "Later");
    imap.refuse.set("Google", `down ${SECRET}`);
    await h.tick();
    expect(h.status()).toMatchObject({ state: "error", failures: 1 });
    expect(JSON.stringify(h.status())).not.toContain(SECRET);
    imap.refuse.delete("Google");
    await h.tick();
    expect(h.status()).toMatchObject({ state: "running", failures: 0 });
    h.stop();
    expect(h.status().state).toBe("stopped");
  });

  it("a login file other users can read is refused and shown as a problem in health", async () => {
    const f = join(dir, "mail-open.json");
    writeFileSync(f, JSON.stringify({ account: "Google", host: "h.test", user: ME, pass: SECRET }));
    chmodSync(f, 0o644);
    const s = mail().status();
    expect(s).toMatchObject({ state: "off", reason: "no usable mail login file" });
    expect(s.problems[0]).toMatch(/mode 644/);
    expect(JSON.stringify(s)).not.toContain(SECRET);
  });
});
