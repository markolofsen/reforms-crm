import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { OsaRun } from "@hub/send";
import { createApp } from "./app";
import { parseSent, RUNNING_SCRIPT, SENT_SCRIPT } from "./apple-mail";
import { matchSent, startSentReconciler } from "./sent";

// Sent detection reads Apple Mail through a fake `OsaRun`: no test reaches Mail.
const ANNA = "anna@example.test";
let handle: DbHandle;
let repos: Repos;
const FS = "\x1f";
const RS = "\x1e";
const LS = "\x1d";

/** A fake Mail: `running`, and the Sent messages per account. Records every script it was asked to run. */
function fakeMail(o: { running?: boolean; sent?: Record<string, string[]>; fail?: string } = {}) {
  const calls: { script: "running" | "sent" | "other"; args: string[] }[] = [];
  const osa: OsaRun = async (script, args) => {
    const kind = script === RUNNING_SCRIPT ? "running" : script === SENT_SCRIPT ? "sent" : "other";
    calls.push({ script: kind, args });
    if (kind === "running") return o.running === false ? "false\n" : "true\n";
    if (o.fail) throw new Error(o.fail);
    return (o.sent?.[args[0] ?? ""] ?? []).join("");
  };
  return { osa, calls };
}

/** One Sent record as the script prints it. `at` is read as this machine's local time, as Mail reports it. */
function sentRecord(m: { id: string; to?: string; subject?: string; irt?: string; head?: string; at?: Date }) {
  const at = m.at ?? new Date(Date.now() + 60_000);
  const stamp = `${at.getFullYear()},${at.getMonth() + 1},${at.getDate()},${at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds()}`;
  return [m.id, m.irt ?? "", stamp, `${m.to ?? ANNA}${LS}`, "", m.subject ?? "Re: Hello", m.head ?? "Hi Anna"].join(FS) + RS;
}

const settings = (accounts = ["Google"]) => JSON.stringify({ schema: 1, slug: "p", kind: "x", name: "P", mail: { accounts, addresses: ["me@example.test"], sentMailbox: "Sent Mail" } });
const register = (o: { accounts?: string[]; status?: string } = {}) =>
  repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: (o.status ?? "active") as "active", settingsJson: settings(o.accounts), hash: "h" }], addresses: [] });
const record = (subject = "Re: Hello", mailRef = "<thread1@x>") => repos.drafts.record({ project: "p", email: ANNA, name: "Anna", subject, mailRef });
const statusOf = async (id: number) => (await repos.drafts.get(id))!;
const reconciler = (osa: OsaRun) => startSentReconciler({ repos, osa, env: {}, timer: false });

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

describe("Sent detection through Apple Mail", () => {
  it("marks a draft whose sent message still carries its [hub-draft] marker", async () => {
    await register();
    const r = await record();
    const mail = fakeMail({ sent: { Google: [sentRecord({ id: "<sent1@x>", subject: "Another subject", head: "[hub-draft thread=thread1@x]\nHi Anna" })] } });
    const h = reconciler(mail.osa);
    await h.tick();
    expect(await statusOf(r.draftId)).toMatchObject({ status: "sent", sentVia: "marker", sentMessageId: "sent1@x" });
    expect(h.status()).toMatchObject({ state: "running", projects: ["p"], marked: 1 });
    // The read names the account, the project's Sent mailbox, and a start a day before the draft.
    const read = mail.calls.find((c) => c.script === "sent")!;
    expect(read.args.slice(0, 2)).toEqual(["Google", "Sent Mail"]);
  });

  it("marks a draft by its Message-ID, and also by the thread it answers", async () => {
    await register();
    const byId = await record("Re: One", "<draft-own@x>");
    const byThread = await repos.drafts.record({ project: "p", email: "bob@example.test", name: "Bob", subject: "Re: Two", mailRef: "<bob-thread@x>" });
    const mail = fakeMail({ sent: { Google: [sentRecord({ id: "<draft-own@x>", subject: "Changed" }), sentRecord({ id: "<s2@x>", to: "bob@example.test", subject: "Changed too", irt: "<bob-thread@x>" })] } });
    await reconciler(mail.osa).tick();
    expect(await statusOf(byId.draftId)).toMatchObject({ status: "sent", sentVia: "message-id" });
    expect(await statusOf(byThread.draftId)).toMatchObject({ status: "sent", sentVia: "thread" });
  });

  it("never marks someone else's mail, another subject, or a send from before the draft", async () => {
    await register();
    const r = await record("Re: Hello", "<t@x>");
    const old = new Date(Date.now() - 3 * 86_400_000);
    const mail = fakeMail({ sent: { Google: [sentRecord({ id: "<o1@x>", subject: "Other" }), sentRecord({ id: "<o2@x>", to: "else@example.test" }), sentRecord({ id: "<o3@x>", at: old })] } });
    await reconciler(mail.osa).tick();
    expect((await statusOf(r.draftId)).status).toBe("ready");
  });

  it("Mail closed: it is not launched, nothing is read, and health says why", async () => {
    await register();
    const r = await record();
    const mail = fakeMail({ running: false, sent: { Google: [sentRecord({ id: "<thread1@x>" })] } });
    const h = reconciler(mail.osa);
    await h.tick();
    expect(mail.calls.map((c) => c.script)).toEqual(["running"]);
    expect(h.status()).toMatchObject({ state: "off", reason: "Mail is not running" });
    expect((await statusOf(r.draftId)).status).toBe("ready");
    const body = (await (await createApp(repos, { sent: h.status }).request("http://127.0.0.1:4317/api/health")).json()) as Record<string, unknown>;
    expect(body.sent).toMatchObject({ state: "off", reason: "Mail is not running" });
    expect(body).not.toHaveProperty("mail");
  });

  it("nothing waiting: no osascript call at all", async () => {
    await register();
    const r = await record();
    await repos.drafts.setStatus(r.draftId, "skipped");
    const mail = fakeMail();
    const h = reconciler(mail.osa);
    await h.tick();
    expect(mail.calls).toEqual([]);
    expect(h.status()).toMatchObject({ state: "off", reason: "no draft waits to be seen in Sent" });
  });

  it("skips a project that is not active or lists no account, and is off for HUB_SENT=off or the fake Mailer", async () => {
    await register({ status: "paused" });
    await record();
    const mail = fakeMail();
    await reconciler(mail.osa).tick();
    await register({ accounts: [] });
    await reconciler(mail.osa).tick();
    expect(mail.calls).toEqual([]);
    const off = startSentReconciler({ repos, osa: mail.osa, env: { HUB_SENT: "off" }, timer: false });
    await off.tick();
    expect(off.status()).toMatchObject({ state: "off", reason: "HUB_SENT=off" });
    const demo = startSentReconciler({ repos, osa: mail.osa, env: {}, offReason: "demo mode", timer: false });
    await demo.tick();
    expect(demo.status()).toMatchObject({ state: "off", reason: "demo mode" });
    expect(mail.calls).toEqual([]);
  });

  it("a failing read is an error with a count, then recovers", async () => {
    await register();
    await record();
    const bad = fakeMail({ fail: "Mail got an error: Can't get mailbox" });
    const h = startSentReconciler({ repos, osa: bad.osa, env: {}, timer: false });
    await h.tick();
    expect(h.status()).toMatchObject({ state: "error", failures: 1 });
    expect(h.status().lastError).toContain("p / Google");
    h.stop();
    expect(h.status().state).toBe("stopped");
  });

  it("a follow-up step found in Sent advances its enrollment (P47)", async () => {
    await register();
    const clientId = await repos.clients.create({ project: "p", email: ANNA, name: "Anna", repliesOwed: false, lastContactAt: new Date(Date.now() - 12 * 86_400_000).toISOString() });
    await repos.drafts.create({ project: "p", clientId, subject: "Re: x", toAddr: ANNA, body: "b", status: "sent", sentAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), mailClass: "client" });
    const e = await repos.enrollments.enrol({ project: "p", clientId, sequence: "s", sequenceHash: "h", schedule: { delays: [2, 3], businessDays: false }, by: "owner", now: new Date(Date.now() - 5 * 86_400_000) });
    const step = await repos.drafts.record({ project: "p", email: ANNA, name: "Anna", subject: "Following up", mailRef: "<our-last@x>", skill: "sequence-drafts", sequence: { enrollmentId: e.id, step: 1 } });
    await reconciler(fakeMail({ sent: { Google: [sentRecord({ id: "<fu1@x>", subject: "Following up", irt: "<our-last@x>" })] } }).osa).tick();
    expect((await statusOf(step.draftId)).status).toBe("sent");
    expect(await repos.enrollments.get("p", e.id, new Date())).toMatchObject({ step: 2, state: "active" });
  });
});

describe("matchSent and the script's output", () => {
  it("one sent message satisfies one draft, the oldest first", () => {
    const sent = parseSent(sentRecord({ id: "<one@x>", subject: "Re: Same" }), "Google");
    const d = (id: number, createdAt: string) => ({ id, subject: "Same", toAddr: ANNA, mailRef: null, createdAt });
    expect(matchSent([d(2, "2026-01-02T00:00:00Z"), d(1, "2026-01-01T00:00:00Z")], sent).map((m) => m.draftId)).toEqual([1]);
  });
  it("parses ids bare and skips a record with no id", () => {
    const out = sentRecord({ id: "<A@X>", irt: "<B@X>" }) + ["", "", "2026,1,1,0", "", "", "s", ""].join(FS) + RS;
    expect(parseSent(out, "G")).toEqual([expect.objectContaining({ messageId: "a@x", inReplyTo: "b@x", marker: null, account: "G" })]);
  });
});
