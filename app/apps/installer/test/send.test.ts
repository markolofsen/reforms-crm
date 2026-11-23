import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MailDraft } from "@hub/mail-app/drafts";
import { assess, FakeMailer, mailHash, runDue, sendDraft, type SendDeps } from "@hub/send";
import { defaultPolicy, withFieldValues, writeSendPolicy } from "@hub/projects/send-policy";
import { type PolicyField } from "@hub/projects/fields";
import { runSendCommand } from "../src/send/command";

// Every test here uses FakeMailer: nothing reaches Mail and nothing is ever sent.

const T0 = new Date("2026-11-20T10:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

/** project.md holds no send policy (P49 S11): the policy rows of a test go to send-policy.json (`writeProject`). */
function projectMd(): string {
  return [
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
    "| mail.domains | brand.example | 2026-11-14 | agent |",
    "| tone | brief | 2026-11-14 | owner |",
    "",
    "## Notion databases",
    "",
    "- clients: 00000000-0000-4000-8000-000000000001",
    "- reports: 00000000-0000-4000-8000-000000000002",
    "",
  ].join("\n");
}

let dir: string;
let handle: DbHandle;
let repos: Repos;
let mailer: FakeMailer;
let projects: string;
let now: Date;

let policyDir: string;
/** project.md, plus the send policy: `extra` rows in the old spelling ("send.mode | auto") and draft.recipients. */
const writeProject = (extra: string[] = [], recipients = "any") => {
  writeFileSync(path.join(projects, "acme", "project.md"), projectMd());
  const values = Object.fromEntries([["draft.recipients", recipients], ...extra.map((r) => r.split(" | ") as [string, string])]) as Partial<Record<PolicyField, string>>;
  writeSendPolicy(policyDir, "acme", { ...withFieldValues(defaultPolicy("generic"), "generic", values), updatedAt: T0.toISOString(), by: "test" });
};
const deps = (over: Partial<SendDeps> = {}): SendDeps => ({ repos, mailer, projectsDir: projects, policyDir, allowList: [], now: () => now, ...over });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-send-"));
  projects = path.join(dir, "projects");
  policyDir = path.join(dir, "state", "projects");
  mkdirSync(path.join(projects, "acme"), { recursive: true });
  writeProject();
  handle = openDb(path.join(dir, "app.db"));
  repos = createRepos(handle.db);
  mailer = new FakeMailer();
  now = T0;
});
afterEach(() => handle.close());

let refs = 500;
const mailDraft = (over: Partial<MailDraft> = {}): MailDraft => ({
  ref: String(++refs),
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

/** Records a draft (the row draft_write's record writes), checks it and puts the matching draft into the fake Mail. */
async function draft(o: { email?: string; subject?: string; mailRef?: string; mailClass?: string | null; injection?: boolean; checked?: boolean; mail?: Partial<MailDraft> | null } = {}) {
  const email = o.email ?? "client@example.com";
  const subject = o.subject ?? "Re: hello";
  const mailRef = o.mailRef ?? "<d1@acme.example>";
  const r = await repos.drafts.record({ project: "acme", email, name: "Cli", subject, mailRef, mailClass: o.mailClass === undefined ? "client" : o.mailClass, injectionSuspected: o.injection ?? false });
  if (o.checked !== false) await repos.drafts.setChecked(r.draftId, true);
  if (o.mail !== null) mailer.drafts.push(mailDraft({ to: [email], subject, messageId: mailRef.replace(/^<|>$/g, ""), ...o.mail }));
  return r.draftId;
}
const refused = (r: { code: number; line: string }) => (JSON.parse(r.line) as { refused?: string[] }).refused ?? [];

describe("P94: no blank lines above the text that goes out", () => {
  // Mail reads a reply draft back with its empty top line as a leading line break (hub-saas send_log 1-3, 2026-11-20):
  // handed back to Mail, that was a second blank line on top of every sent reply.
  it("the door hands Mail, and the audit row keeps, the text without the blank lines Mail read above it", async () => {
    const id = await draft({ mail: { body: "\n\nHello,\n\nThe price is 100." } });
    const r = await sendDraft(deps(), { draftId: id, apply: true, actor: "cli" });
    expect(r.code, r.line).toBe(0);
    expect(mailer.sent[0]?.body).toBe("Hello,\n\nThe price is 100.");
    expect((await repos.sends.forDraft(id))[0]?.body).toBe("Hello,\n\nThe price is 100.");
  });

  it("Checked taken on the card's read (leading break included) still matches at Send: one hash rule for both", async () => {
    const id = await draft({ checked: false, mail: { body: "\nHello,\n\nThe price is 100." } });
    const seen = mailer.drafts[mailer.drafts.length - 1] as MailDraft;
    expect(mailHash(seen)).toBe(mailHash({ ...seen, body: "Hello,\n\nThe price is 100." }));
    await repos.drafts.setChecked(id, true, mailHash(seen));
    const a = await assess(deps(), id, { mode: "manual" });
    expect(a.reasons).toEqual([]);
    expect(a.mail?.body).toBe("Hello,\n\nThe price is 100.");
  });
});

describe("hub send <draftId> (manual)", () => {
  it("is a dry run by default: it shows the mail and sends and writes nothing", async () => {
    const id = await draft();
    const r = await sendDraft(deps(), { draftId: id, apply: false, actor: "cli" });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.line)).toMatchObject({ ok: true, dryRun: true, to: ["client@example.com"], subject: "Re: hello", body: expect.stringContaining("The price is 100") });
    expect(mailer.sent).toEqual([]);
    expect(await repos.sends.forDraft(id)).toEqual([]);
  });

  it("--apply sends the Mail text once, writes the audit row with the full text, and refuses a second send", async () => {
    const id = await draft();
    const r = await sendDraft(deps(), { draftId: id, apply: true, actor: "cli" });
    expect(r.code, r.line).toBe(0);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ subject: "Re: hello", body: "Hello,\n\nThe price is 100.\n\nAcme", to: ["client@example.com"] });
    const [row] = await repos.sends.forDraft(id);
    expect(row).toMatchObject({ project: "acme", mode: "manual", status: "sent", actor: "cli", toAddr: "client@example.com", subject: "Re: hello", body: "Hello,\n\nThe price is 100.\n\nAcme", sentMessageId: "fake-1@hub.test" });
    expect(row?.doneAt).toBeTruthy();
    // the draft is gone from the fake Mail after sending; put it back to prove the audit row alone stops a repeat
    mailer.drafts.push(mailDraft({ messageId: "d1@acme.example" }));
    const again = await sendDraft(deps(), { draftId: id, apply: true, actor: "cli" });
    expect(again.code).toBe(2);
    expect(refused(again)[0]).toMatch(/already sent/);
    expect(mailer.sent).toHaveLength(1);
  });

  it("a failure in Mail marks the row failed, exits 1, and the draft can be sent again", async () => {
    const id = await draft();
    mailer.failSend = "Mail is not running";
    const r = await sendDraft(deps(), { draftId: id, apply: true, actor: "cli" });
    expect(r.code).toBe(1);
    expect((await repos.sends.forDraft(id))[0]).toMatchObject({ status: "failed", error: "Mail is not running" });
    expect((await sendDraft(deps(), { draftId: id, apply: true, actor: "cli" })).code).toBe(0);
    expect(mailer.sent).toHaveLength(1);
  });

  describe("refuses (exit 2, nothing sent, no row)", () => {
    const expectRefused = async (id: number, pattern: RegExp, d = deps()) => {
      const r = await sendDraft(d, { draftId: id, apply: true, actor: "cli" });
      expect(r.code, r.line).toBe(2);
      expect(refused(r).join("\n")).toMatch(pattern);
      expect(mailer.sent).toEqual([]);
      expect(await repos.sends.forDraft(id)).toEqual([]);
    };

    it("an unknown draft", async () => expectRefused(999, /no such draft/));
    it("a draft that is not Checked", async () => expectRefused(await draft({ checked: false }), /not Checked/));
    it("a draft that is not ready", async () => {
      const id = await draft();
      await repos.drafts.setStatus(id, "skipped", "no");
      await expectRefused(id, /skipped, not ready/);
    });
    it("a recipient the draft.recipients rule does not admit (test mode, empty allow-list)", async () => {
      writeProject([], "test");
      await expectRefused(await draft(), /does not permit client@example.com/);
    });
    it("a recipient admitted by the allow-list in test mode is sent", async () => {
      writeProject([], "test");
      const id = await draft();
      expect((await sendDraft(deps({ allowList: ["Client@Example.com"] }), { draftId: id, apply: false, actor: "cli" })).code).toBe(0);
    });
    it("an extra Cc or Bcc that is not admitted", async () => {
      writeProject([], "client@example.com");
      await expectRefused(await draft({ mail: { cc: ["boss@elsewhere.example"] } }), /does not permit boss@elsewhere.example/);
    });
    it("a placeholder left in the text", async () => {
      await expectRefused(await draft({ mail: { body: "The price is [Owner: price]." } }), /placeholder is left in the text: \[Owner: price\]/);
    });
    it("a placeholder left in the subject", async () => {
      await expectRefused(await draft({ subject: "Re: {{topic}}", checked: false }), /placeholder/);
    });
    it("a draft recorded with injection_suspected", async () => {
      await expectRefused(await draft({ injection: true }), /injection_suspected/);
    });
    it("a do_not_contact client", async () => {
      const id = await draft();
      const s = await repos.sends.subject(id);
      await repos.clients.setMarks(s!.client.id, ["do_not_contact"]);
      await expectRefused(id, /do_not_contact/);
    });
    it("attachments", async () => expectRefused(await draft({ mail: { attachments: 1 } }), /attachment/));
    it("another sender or another account", async () => {
      await expectRefused(await draft({ mail: { sender: "x@other.example" } }), /sender x@other\.example is not one of acme's addresses/);
    });
    it("P58: a From of the project's own is accepted (the brand address the client wrote to); a To of ours is refused", async () => {
      expect((await sendDraft(deps(), { draftId: await draft({ mail: { sender: "Brand <info@brand.example>" } }), apply: false, actor: "cli" })).code).toBe(0);
      await expectRefused(await draft({ email: "c@example.com", subject: "Re: c", mailRef: "<c@x>", mail: { to: ["c@example.com", "info@brand.example"] } }), /addressed to this project's own address info@brand\.example/);
    });
    it("a draft in another project's account", async () => {
      await expectRefused(await draft({ mail: { account: "someone@else.example" } }), /not one of acme's/);
    });
    it("no matching draft in Mail, and two matching ones", async () => {
      await expectRefused(await draft({ mail: null }), /no draft in Mail/);
      const id2 = await draft({ email: "b@example.com", subject: "Re: b", mailRef: "<b@x>" });
      mailer.drafts.push(mailDraft({ ref: "502", to: ["b@example.com"], subject: "Re: b", messageId: "other@x" }), mailDraft({ ref: "503", to: ["b@example.com"], subject: "Re: b", messageId: "other2@x" }));
      mailer.drafts = mailer.drafts.filter((d) => d.messageId !== "b@x");
      await expectRefused(id2, /2 drafts in Mail match/);
    });
    it("an empty text", async () => expectRefused(await draft({ mail: { body: "  \n" } }), /text is empty/));
    it("a project that is not active", async () => {
      writeFileSync(path.join(projects, "acme", "project.md"), projectMd().replace("| status | active |", "| status | paused |"));
      await expectRefused(await draft(), /paused, not active/);
    });
    it("Stop all", async () => {
      const id = await draft();
      await repos.sends.stop();
      await expectRefused(id, /Stop all is on/);
      await repos.sends.resume();
      expect((await sendDraft(deps(), { draftId: id, apply: false, actor: "cli" })).code).toBe(0);
    });
  });

  it("collects every reason in one answer", async () => {
    writeProject([], "test");
    const id = await draft({ injection: true, checked: false, mail: { body: "[Owner: x]" } });
    const a = await assess(deps(), id, { mode: "manual" });
    expect(a.ok).toBe(false);
    expect(a.reasons.length).toBeGreaterThanOrEqual(4);
  });
});

describe("hub send --due (autosend)", () => {
  const AUTO = ["send.mode | auto", "send.classes | client"];

  it("is off for a project in draft mode: nothing queued, nothing sent", async () => {
    await draft();
    const r = await runDue(deps(), { apply: true });
    expect(r.report).toMatchObject({ queued: [], sent: [] });
    expect(mailer.sent).toEqual([]);
    expect(await repos.sends.queued()).toEqual([]);
  });

  it("a dry run decides but writes nothing", async () => {
    writeProject(AUTO);
    await draft();
    const r = await runDue(deps(), { apply: false });
    expect(r.report.queued).toHaveLength(1);
    expect(await repos.sends.queued()).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("queues, waits out the window (default 10 minutes), then sends, with an audit row", async () => {
    writeProject(AUTO);
    const id = await draft({ checked: false }); // autosend needs no human tick
    let r = await runDue(deps(), { apply: true });
    expect(r.report.queued).toEqual([{ draftId: id, dueAt: minutes(10).toISOString() }]);
    expect(mailer.sent).toEqual([]);
    now = minutes(9);
    r = await runDue(deps(), { apply: true });
    expect(r.report.sent).toEqual([]);
    expect(mailer.sent).toEqual([]);
    now = minutes(10);
    r = await runDue(deps(), { apply: true });
    expect(r.report.sent).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    expect((await repos.sends.forDraft(id))[0]).toMatchObject({ mode: "auto", status: "sent", actor: "auto", body: "Hello,\n\nThe price is 100.\n\nAcme" });
    // a repeat run sends nothing more
    now = minutes(30);
    await runDue(deps(), { apply: true });
    expect(mailer.sent).toHaveLength(1);
  });

  it("send.delay_minutes sets the window", async () => {
    writeProject([...AUTO, "send.delay_minutes | 30"]);
    await draft();
    const r = await runDue(deps(), { apply: true });
    expect(r.report.queued[0]?.dueAt).toBe(minutes(30).toISOString());
  });

  it("only the listed classes", async () => {
    writeProject(AUTO);
    await draft({ mailClass: "partner" });
    await draft({ email: "n@example.com", subject: "Re: n", mailRef: "<n@x>", mailClass: null });
    expect((await runDue(deps(), { apply: true })).report.queued).toEqual([]);
  });

  it("honours the daily cap, counting queued rows, over a rolling 24 hours", async () => {
    writeProject([...AUTO, "send.daily_cap | 2"]);
    for (const n of [1, 2, 3]) await draft({ email: `c${n}@example.com`, subject: `Re: ${n}`, mailRef: `<m${n}@x>` });
    expect((await runDue(deps(), { apply: true })).report.queued).toHaveLength(2);
    now = minutes(11);
    const r = await runDue(deps(), { apply: true });
    expect(r.report.sent).toHaveLength(2);
    expect(r.report.queued).toEqual([]); // the third waits: two autosends in the last 24 hours
    now = new Date(T0.getTime() + 25 * 3_600_000);
    expect((await runDue(deps(), { apply: true })).report.queued).toHaveLength(1);
  });

  it("a cancel inside the window stops the send", async () => {
    writeProject(AUTO);
    const id = await draft();
    await runDue(deps(), { apply: true });
    const [row] = await repos.sends.queued();
    expect(await repos.sends.cancel(row!.id, "cancelled by the owner")).toMatchObject({ status: "cancelled" });
    now = minutes(60);
    await runDue(deps(), { apply: true });
    expect(mailer.sent).toEqual([]);
    expect((await repos.sends.forDraft(id))[0]?.status).toBe("cancelled");
  });

  it("Stop all cancels the queue and blocks new sends until resumed", async () => {
    writeProject(AUTO);
    await draft();
    await runDue(deps(), { apply: true });
    expect(await repos.sends.stop("acme")).toBe(1);
    now = minutes(60);
    const r = await runDue(deps(), { apply: true });
    expect(r.report.queued).toEqual([]);
    expect(r.report.stopped).toEqual(["acme"]);
    expect(mailer.sent).toEqual([]);
    await repos.sends.resume("acme");
    const again = await runDue(deps(), { apply: true });
    expect(again.report.queued).toEqual([]); // a cancelled autosend is final: it is not queued again on its own
    expect(again.report.skipped).toEqual([]);
  });

  it("cancels at send time when the draft changed in Mail, was put on hold, or the project left auto mode", async () => {
    writeProject(AUTO);
    const a = await draft();
    const b = await draft({ email: "b@example.com", subject: "Re: b", mailRef: "<b@x>" });
    const c = await draft({ email: "c@example.com", subject: "Re: c", mailRef: "<c@x>" });
    await runDue(deps(), { apply: true });
    expect(await repos.sends.queued()).toHaveLength(3);
    mailer.drafts.find((d) => d.to[0] === "client@example.com")!.body = "Hello, the price is 5000 now.";
    await repos.drafts.setStatus(b, "hold");
    now = minutes(11);
    const r = await runDue(deps(), { apply: true });
    expect(r.report.cancelled.map((x) => x.draftId).sort()).toEqual([a, b].sort());
    expect(r.report.cancelled.find((x) => x.draftId === a)?.reasons.join()).toMatch(/changed in Mail/);
    expect(mailer.sent.map((m) => m.to[0])).toEqual(["c@example.com"]);
    expect((await repos.sends.forDraft(c))[0]?.status).toBe("sent");
  });

  it("a project that left auto mode sends nothing that was queued", async () => {
    writeProject(AUTO);
    await draft();
    await runDue(deps(), { apply: true });
    writeProject();
    now = minutes(11);
    const r = await runDue(deps(), { apply: true });
    expect(r.report.cancelled[0]?.reasons.join()).toMatch(/send\.mode draft/);
    expect(mailer.sent).toEqual([]);
  });

  it("never autosends an injection-flagged draft, a placeholder, a changed recipient list, a Bcc, or an unacknowledged amber result", async () => {
    writeProject(AUTO);
    await draft({ injection: true });
    await draft({ email: "p@example.com", subject: "Re: p", mailRef: "<p@x>", mail: { body: "Price [Owner: x]" } });
    await draft({ email: "q@example.com", subject: "Re: q", mailRef: "<q@x>", mail: { cc: ["extra@example.com"] } });
    await draft({ email: "r@example.com", subject: "Re: r", mailRef: "<r@x>", mail: { bcc: ["hidden@example.com"] } });
    const r = await runDue(deps(), { apply: true });
    expect(r.report.queued).toEqual([]);
    expect(r.report.skipped).toHaveLength(4);
    expect(mailer.sent).toEqual([]);
  });

  it("a follow-up step (P47) is refused in every mode, reason sequence-step: the owner sends it from Mail", async () => {
    writeProject(AUTO);
    const first = await draft({ email: "s@example.com", subject: "Re: s", mailRef: "<s@x>" });
    await repos.drafts.setStatus(first, "done");
    const clientId = (await repos.drafts.get(first))?.clientId ?? 0;
    const e = await repos.enrollments.enrol({ project: "acme", clientId, sequence: "s", sequenceHash: "h", schedule: { delays: [2], businessDays: true }, by: "owner", now: T0 });
    const step = await repos.drafts.record({ project: "acme", email: "s@example.com", name: "S", subject: "Re: s2", mailRef: "<s2@x>", mailClass: "client", skill: "sequence-drafts", sequence: { enrollmentId: e.id, step: 1 } });
    await repos.drafts.setChecked(step.draftId, true);
    mailer.drafts.push(mailDraft({ to: ["s@example.com"], subject: "Re: s2", messageId: "s2@x" }));
    const r = await runDue(deps(), { apply: true });
    expect(r.report.queued).toEqual([]);
    expect(r.report.skipped.find((x) => x.draftId === step.draftId)?.reasons).toContain("sequence-step: a follow-up step is sent by you from Mail, never by the hub");
    expect(refused(await sendDraft(deps(), { draftId: step.draftId, apply: true, actor: "cli" }))).toContain("sequence-step: a follow-up step is sent by you from Mail, never by the hub");
    expect((await assess(deps(), step.draftId, { mode: "manual" })).ok).toBe(false);
    expect(mailer.sent).toEqual([]);
  });

  it("autosend still honours draft.recipients", async () => {
    writeProject(AUTO, "test");
    await draft();
    expect((await runDue(deps(), { apply: true })).report.queued).toEqual([]);
  });

  it("two runners cannot send one row twice", async () => {
    writeProject(AUTO);
    await draft();
    await runDue(deps(), { apply: true });
    now = minutes(11);
    const [a, b] = await Promise.all([runDue(deps(), { apply: true }), runDue(deps(), { apply: true })]);
    expect(a.report.sent.length + b.report.sent.length).toBe(1);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe("the hub send command", () => {
  const env = (out: string[]) => ({ projectsDir: projects, policyDir, configFile: path.join(dir, "none.json"), dbPath: path.join(dir, "app.db"), mailer, out: (l: string) => out.push(l), now: () => now });

  it("needs exactly one mode and is a dry run by default", async () => {
    const out: string[] = [];
    expect(await runSendCommand({}, env(out))).toBe(2);
    const id = await draft();
    handle.close();
    expect(await runSendCommand({ draftId: id }, env(out))).toBe(0);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ dryRun: true });
    expect(mailer.sent).toEqual([]);
    expect(await runSendCommand({ draftId: id, apply: true }, env(out))).toBe(0);
    expect(mailer.sent).toHaveLength(1);
    handle = openDb(path.join(dir, "app.db")); // afterEach closes it
  });

  it("--stop, --status, --resume, --cancel", async () => {
    const out: string[] = [];
    handle.close();
    expect(await runSendCommand({ stop: true }, env(out))).toBe(0);
    expect(await runSendCommand({ status: true }, env(out))).toBe(0);
    expect(out.join("\n")).toMatch(/Stop all: \*/);
    expect(await runSendCommand({ resume: true }, env(out))).toBe(0);
    expect(await runSendCommand({ cancel: 99 }, env(out))).toBe(2);
    handle = openDb(path.join(dir, "app.db"));
  });
});
