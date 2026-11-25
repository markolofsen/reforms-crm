import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAIL_PASS_FIRST_REPLY_REASON, LEAD_FIRST_REPLY_REASON } from "@hub/config/lead-pass";
import { fakeLeadPassBrain } from "@hub/agent/lead-pass";
import { createRepos, openDb, type DbHandle, type NewInbound, type Repos } from "@hub/db";
import type { MailDraft } from "@hub/mail-app/drafts";
import { setSendPolicy } from "@hub/projects/send-policy";
import { FakeMailer } from "@hub/send/mailer";
import { assess, type SendDeps } from "@hub/send/assess";
import { testApp } from "../support/runtime";
import { batchRuns } from "../../src/send/batch-door";
import { runMailPass } from "../../src/passes/mail-pass";

// P147 3h (decision 0055 point 9): the mail pass on the fake brain. Its list is the Mail reader's open threads (one per sender,
// newest), its drafts join the day's lead batch, phishing is no_reply, a new sender's reply opens unticked in the review, the
// review click applies a No reply proposal as the owner's No reply needed, and autosend holds a first reply to a new sender.
// FakeMailer throughout: nothing reaches Mail.

const projectMd = ["# Acme", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | owner@acme.example | 2026-11-14 | agent |", "| mail.addresses | owner@acme.example | 2026-11-14 | owner |", "| mail.sender | owner@acme.example | 2026-11-14 | owner |", ""].join("\n");
const NOW = new Date();
const at = (hAgo: number) => new Date(NOW.getTime() - hAgo * 3_600_000).toISOString();
const H = { "content-type": "application/json" };
const ADMIN = { ...H, origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" };

let dir: string;
let handle: DbHandle;
let repos: Repos;
let mailer: FakeMailer;
let deps: SendDeps;

const inbound = (n: number, o: Partial<NewInbound> = {}): NewInbound => ({ project: "acme", account: "owner@acme.example", mailbox: "INBOX", messageId: `m${n}@x.test`, email: `p${n}@corp${n}.example`, name: `Person ${n}`, subject: `Question ${n}`, receivedAt: at(n), read: false, why: "client", preview: `Hello, a question ${n}`, ...o });
const mailOf = (to: string, ref: string): MailDraft => ({ ref, messageId: `d-${ref}@acme.example`, account: "owner@acme.example", inReplyTo: null, sender: "Acme <owner@acme.example>", to: [to], cc: [], bcc: [], subject: "Re: Question", body: "Hello,\n\nThe answer.", attachments: 0 }) as MailDraft;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hub-mail-pass-"));
  mkdirSync(join(dir, "projects", "acme"), { recursive: true });
  writeFileSync(join(dir, "projects", "acme", "project.md"), projectMd);
  handle = openDb(join(dir, "app.db"));
  repos = createRepos(handle.db);
  mailer = new FakeMailer();
  const policyDir = join(dir, "state", "projects");
  setSendPolicy(policyDir, "acme", "generic", { "draft.recipients": "any" }, "test");
  deps = { repos, mailer, projectsDir: join(dir, "projects"), policyDir, allowList: [] };
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = () => runMailPass({ repos, brain: fakeLeadPassBrain({ repos }), project: () => undefined }, "acme", "button");

describe("the mail pass (decision 0055 point 9)", () => {
  it("lists each sender's newest open message once, drafts the human ones into the day's lead batch, and decides phishing no_reply", async () => {
    await repos.inboundMail.store([inbound(1), inbound(2, { email: "p1@corp1.example" }), inbound(3, { email: "it-helpdesk@corp-security.example", subject: "Access Renewal required" })], NOW);
    const due = await repos.mailPass.due("acme", at(48));
    expect(due.rows.map((r) => r.email).sort()).toEqual(["it-helpdesk@corp-security.example", "p1@corp1.example"]);
    const row = await run();
    expect(row).toMatchObject({ kind: "mail", listed: 2, turns: 2, replied: 1, noReply: 1, failed: 0, error: null });
    expect((await repos.batches.get("acme", row?.batchId as number))?.intent).toBe("lead_reply");
    const decided = await repos.mailPass.decided("acme", at(48));
    expect(decided.find((r) => r.email.startsWith("it-helpdesk"))).toMatchObject({ passDecision: "no_reply", display: "proposed" });
    expect(decided.find((r) => r.email === "p1@corp1.example")).toMatchObject({ passDecision: "reply", display: "drafted", newSender: true });
    expect((await run())).toMatchObject({ listed: 0, turns: 0 });
    // One ledger with the lead pass: the mail turns count in the day's budget.
    expect(await repos.leadPass.passTurnsSince(at(24))).toBe(2);
    expect(mailer.sent).toEqual([]);
  });

  it("autosend holds a mail-pass reply to a new sender (mail-pass-first-reply), not a lead's reason", async () => {
    await repos.inboundMail.store([inbound(1)], NOW);
    await run();
    const m = (await repos.mailPass.decided("acme", at(48)))[0];
    const draftId = m?.passDraftId as number;
    mailer.drafts.push({ ...mailOf("p1@corp1.example", "801"), inReplyTo: "m1@x.test" } as MailDraft);
    const reasons = (await assess(deps, draftId, { mode: "auto" })).reasons;
    expect(reasons).toContain(MAIL_PASS_FIRST_REPLY_REASON);
    expect(reasons).not.toContain(LEAD_FIRST_REPLY_REASON);
  });

  it("the review shows a new sender's reply unticked and applies a ticked No reply proposal as No reply needed", async () => {
    await repos.inboundMail.store([inbound(1), inbound(3, { email: "it-helpdesk@corp-security.example", subject: "Access Renewal required" })], NOW);
    const row = await run();
    const batchId = row?.batchId as number;
    const app = testApp(repos, { sender: { kind: "fake", mailer, projectsDir: deps.projectsDir, policyDir: deps.policyDir, allowList: [], adminPort: 5173, now: () => NOW, batchRuns: batchRuns({ limits: { dailyCap: 50, spacingSeconds: 0 } }), batchLimits: { dailyCap: 50, spacingSeconds: 0 } } });
    const url = `http://127.0.0.1:4317/api/projects/acme/lead-review/${batchId}`;
    const r = (await (await app.request(url)).json()) as { rows: Array<{ kind: string; newSender: boolean; ticked: boolean }>; proposals: Array<{ kind: string; inbound: number | null; decision: string }> };
    expect(r.rows.map((x) => [x.kind, x.newSender, x.ticked])).toEqual([["mail", true, false]]);
    const p = r.proposals.find((x) => x.kind === "mail");
    expect(p).toMatchObject({ decision: "no_reply" });
    const t = (await (await app.request(`${url}/ticket`, { method: "POST", headers: ADMIN, body: JSON.stringify({ send: [], exclude: [], proposals: [{ inbound: p?.inbound, decision: "no_reply" }] }) })).json()) as { applied: { noReply: number } };
    expect(t.applied.noReply).toBe(1);
    expect((await repos.mailPass.item("acme", p?.inbound as number))?.display).toBe("dismissed");
    expect(mailer.sent).toEqual([]);
  });
});
