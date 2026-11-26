import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAD_FIRST_REPLY_REASON, leadPassRequest } from "@hub/config/lead-pass";
import { createRepos, openDb, type DbHandle, type NewLead, type Repos } from "@hub/db";
import { setSendPolicy } from "@hub/projects/send-policy";
import type { MailDraft } from "@hub/mail-app/drafts";
import { MailNotAnswering } from "@hub/mail-app/osa";
import { FakeMailer } from "@hub/send/mailer";
import { mailHash } from "@hub/send/find";
import { assess, type SendDeps } from "@hub/send/assess";
import { planBatch, runBatch, type BatchOutcome } from "@hub/send/batch";
import { sendDraft } from "@hub/send/deliver";
import { replyAddressOf } from "@hub/notion";
import { testApp } from "../support/runtime";
import { batchRuns } from "../../src/send/batch-door";
import { mechanical } from "../../src/passes/pass";
import type { LeadsHandle } from "../../src/clients/leads-reader";

// P147 L5 (decision 0055 points 2 and 6, D4, D10) and section 3c (E3, E4): the lead review and its one click, the batch run that
// stops on a transport failure, an unknown send never sent twice, autosend's refusal of a first reply, the reply address and the
// one-person rule. FakeMailer throughout: nothing reaches Mail.

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
  "",
].join("\n");

const DAY = "2026-11-25";
const NOW = new Date(`${DAY}T10:00:00.000Z`);
const H = { "content-type": "application/json" };
const ADMIN = { ...H, origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" };
const page = (n: number) => String(n).repeat(32).slice(0, 32);

let dir: string;
let handle: DbHandle;
let repos: Repos;
let mailer: FakeMailer;
let deps: SendDeps;

const lead = (n: number, o: Partial<NewLead> = {}): NewLead => ({ project: "acme", pageId: page(n), name: `Lead ${n}`, email: `l${n}@example.com`, accountEmail: null, brand: "Acme", receivedAt: `${DAY}T0${n}:00:00.000Z`, preview: `Request ${n}`, notionStatus: "New", hasClient: false, ...o });
const mailOf = (n: number, over: Partial<MailDraft> = {}): MailDraft => ({ ref: String(700 + n), messageId: `p${n}@acme.example`, account: "owner@acme.example", inReplyTo: null, sender: "Acme <owner@acme.example>", to: [`l${n}@example.com`], cc: [], bcc: [], subject: `Your request ${n}`, body: `Hello ${n},\n\nThe API answers your request.`, attachments: 0, ...over }) as MailDraft;

/** `n` leads, each with its pass draft (in the day's lead batch) and decision `reply`; one Mail draft each. */
async function day(n: number): Promise<{ batchId: number; ids: number[] }> {
  await repos.leadRows.sync(Array.from({ length: n }, (_, k) => lead(k + 1)), NOW);
  const pass = await repos.leadPass.startPass("acme", "button", NOW.toISOString());
  const ids: number[] = [];
  for (let k = 1; k <= n; k++) {
    const r = await repos.drafts.record({ project: "acme", email: `l${k}@example.com`, name: `Lead ${k}`, subject: `Your request ${k}`, mailRef: null, newThread: true, skill: "lead-pass", ownerRequest: leadPassRequest(DAY, page(k)), leadPass: { pageId: page(k), passId: pass.id, day: DAY } });
    await repos.leadPass.decide({ project: "acme", pageId: page(k), decision: "reply", reason: "a real prospect", passId: pass.id, at: NOW.toISOString() });
    mailer.drafts.push(mailOf(k));
    ids.push(r.draftId);
  }
  return { batchId: (await repos.drafts.get(ids[0] as number))?.batchId as number, ids };
}

const control = () => {
  const updates: BatchOutcome[] = [];
  return { updates, stopped: () => false, wait: async () => undefined, update: (u: BatchOutcome) => void updates.push(u) };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  dir = mkdtempSync(join(tmpdir(), "hub-lead-review-"));
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
  vi.useRealTimers();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a batch run stops on a transport failure (verdict 7, decision 0055 point 6)", () => {
  it("the first Mail failure stops the run; the rest stay Checked, marked Stopped after k of N; Resume sends them", async () => {
    const { batchId, ids } = await day(3);
    for (const id of ids) await repos.drafts.setChecked(id, true);
    const plan = await planBatch(deps, "acme", batchId);
    mailer.failSend = "Mail did not send the message";
    const out = await runBatch(deps, { project: "acme", batchId, items: plan?.items ?? [], limits: { dailyCap: 50, spacingSeconds: 0 }, control: control() });
    expect(out.map((o) => o.status)).toEqual(["failed", "stopped", "stopped"]);
    expect(out[1]?.reasons[0]).toMatch(/^Stopped after 0 of 3: not sent: Mail did not send the message; Resume$/);
    expect((await repos.drafts.get(ids[1] as number))?.checked).toBe(true);
    const again = await runBatch(deps, { project: "acme", batchId, items: (plan?.items ?? []).slice(1), limits: { dailyCap: 50, spacingSeconds: 0 }, control: control() });
    expect(again.map((o) => o.status)).toEqual(["sent", "sent"]);
  });

  it("a refusal of one draft goes on with the next", async () => {
    const { batchId, ids } = await day(2);
    for (const id of ids) await repos.drafts.setChecked(id, true);
    const plan = await planBatch(deps, "acme", batchId);
    await repos.drafts.setChecked(ids[0] as number, false);
    const out = await runBatch(deps, { project: "acme", batchId, items: plan?.items ?? [], limits: { dailyCap: 50, spacingSeconds: 0 }, control: control() });
    expect(out.map((o) => o.status)).toEqual(["refused", "sent"]);
  });
});

describe("an unknown send is never sent twice (D4)", () => {
  it("Mail not answering leaves the send_log row sending, and the next send of that draft is refused", async () => {
    const { ids } = await day(1);
    await repos.drafts.setChecked(ids[0] as number, true, mailHash(mailOf(1)));
    let calls = 0;
    const slow = Object.assign(Object.create(mailer) as FakeMailer, { send: async () => { calls++; throw new MailNotAnswering(120_000); } });
    const r = await sendDraft({ ...deps, mailer: slow }, { draftId: ids[0] as number, apply: true, actor: "admin-batch" });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.line)).toMatchObject({ unknown: true });
    expect((await repos.sends.list("acme")).map((s) => s.status)).toEqual(["sending"]);
    const second = await sendDraft({ ...deps, mailer: slow }, { draftId: ids[0] as number, apply: true, actor: "admin-batch" });
    expect(second.code).toBe(2);
    expect(calls).toBe(1);
  });
});

describe("autosend never sends a first reply to a lead (verdict 11)", () => {
  it("assess in auto mode refuses a lead batch draft with lead-first-reply; manual does not", async () => {
    const { ids } = await day(1);
    await repos.drafts.setChecked(ids[0] as number, true, mailHash(mailOf(1)));
    expect((await assess(deps, ids[0] as number, { mode: "auto" })).reasons).toContain(LEAD_FIRST_REPLY_REASON);
    expect((await assess(deps, ids[0] as number, { mode: "manual" })).reasons).not.toContain(LEAD_FIRST_REPLY_REASON);
  });
});

describe("a draft that needs the owner's input never goes out (3i P1)", () => {
  it("assess refuses an [Owner: …] placeholder in manual and auto mode, and the batch plan holds it", async () => {
    const { batchId, ids } = await day(1);
    const held = mailOf(1, { body: "Hello 1,\n\nThe plan costs [Owner: price] a month." });
    mailer.drafts.splice(0, mailer.drafts.length, held);
    await repos.drafts.setChecked(ids[0] as number, true, mailHash(held));
    for (const mode of ["manual", "auto"] as const) expect((await assess(deps, ids[0] as number, { mode })).reasons).toContain("a placeholder is left in the text: [Owner: price]");
    const plan = await planBatch(deps, "acme", batchId);
    expect(plan?.items.map((i) => i.draftId)).not.toContain(ids[0]);
  });
});

describe("the lead review and its one click (verdict 7, D10)", () => {
  const leadsSpy = () => {
    const calls: string[] = [];
    const h = { setStatus: async (_p: string, id: string, s: string) => (calls.push(`${id}:${s}`), { state: "written" as const, note: null }) } as unknown as LeadsHandle;
    return { calls, h };
  };
  const appWith = (leads?: LeadsHandle) =>
    testApp(repos, { ...(leads ? { leads } : {}), sender: { kind: "fake", mailer, projectsDir: deps.projectsDir, policyDir: deps.policyDir, allowList: [], adminPort: 5173, now: () => NOW, batchRuns: batchRuns({ limits: { dailyCap: 50, spacingSeconds: 0 } }), batchLimits: { dailyCap: 50, spacingSeconds: 0 } } });
  const review = (b: number) => `http://127.0.0.1:4317/api/projects/acme/lead-review/${b}`;

  it("shows every pass draft's full text though none is Checked, and stores the served hash", async () => {
    const { batchId, ids } = await day(2);
    const res = await appWith().request(review(batchId));
    expect(res.status).toBe(200);
    const r = (await res.json()) as { rows: Array<{ draftId: number; mail: { body: string } | null; held: string[]; ticked: boolean; replyWhy: string }> };
    expect(r.rows.map((x) => x.draftId).sort()).toEqual([...ids].sort());
    expect(r.rows.every((x) => x.mail?.body.startsWith("Hello") && x.held.length === 0 && x.ticked)).toBe(true);
    expect(r.rows[0]?.replyWhy).toBe("the email typed on the form");
    expect((await repos.drafts.get(ids[0] as number))?.servedHash).toBe(mailHash(mailOf(1)));
    expect(mailer.sent).toEqual([]);
  });

  it("the click Checks the ticked drafts on the served hash, excludes the unticked, applies the proposals, and its ticket runs P85b", async () => {
    const { batchId, ids } = await day(3);
    await repos.leadRows.sync([lead(4, { email: "bot@spam.example" }), lead(5, { email: "student@example.com" })], NOW);
    await repos.leadPass.decide({ project: "acme", pageId: page(4), decision: "spam", reason: "site is a link shortener", passId: null, at: NOW.toISOString() });
    await repos.leadPass.decide({ project: "acme", pageId: page(5), decision: "not_now", reason: "a student project", passId: null, at: NOW.toISOString() });
    const spy = leadsSpy();
    const app = appWith(spy.h);
    const shown = (await (await app.request(review(batchId))).json()) as { proposals: Array<{ pageId: string }> };
    expect(shown.proposals.map((p) => p.pageId).sort()).toEqual([page(4), page(5)]);
    // An edit after the review read: that draft is held, never Checked on the old text.
    mailer.drafts = mailer.drafts.map((m) => (m.to[0] === "l2@example.com" ? { ...m, body: `${m.body}\nedited` } : m));
    const body = { send: [ids[0], ids[1]], exclude: [ids[2]], proposals: [{ pageId: page(4), decision: "spam" }, { pageId: page(5), decision: "not_now" }] };
    expect((await app.request(`${review(batchId)}/ticket`, { method: "POST", headers: H, body: JSON.stringify(body) })).status).toBe(403);
    const t = (await (await app.request(`${review(batchId)}/ticket`, { method: "POST", headers: ADMIN, body: JSON.stringify(body) })).json()) as { ticket: string; items: Array<{ draftId: number; hash: string }>; held: Array<{ draftId: number; reasons: string[] }>; applied: { spam: number; notNow: number; excluded: number } };
    expect(t.items.map((i) => i.draftId)).toEqual([ids[0]]);
    expect(t.held.map((h) => h.draftId)).toEqual([ids[1]]);
    expect(t.held[0]?.reasons[0]).toMatch(/changed in Mail after the review/);
    expect(t.applied).toMatchObject({ spam: 1, notNow: 1, excluded: 1 });
    expect(spy.calls).toEqual([`${page(4)}:Spam`]);
    expect((await repos.drafts.get(ids[0] as number))).toMatchObject({ checked: true, checkedHash: mailHash(mailOf(1)) });
    expect((await repos.drafts.get(ids[1] as number))?.checked).toBe(false);
    expect((await repos.leadPass.item("acme", page(3)))?.display).toBe("excluded");
    expect(mailer.sent).toEqual([]);
    const run = await app.request(`http://127.0.0.1:4317/api/projects/acme/batches/${batchId}/send`, { method: "POST", headers: H, body: JSON.stringify({ apply: true, ticket: t.ticket, items: t.items.map((i) => ({ draftId: i.draftId, hash: i.hash })) }) });
    expect(run.status).toBe(202);
    for (let k = 0; k < 100 && mailer.sent.length < 1; k++) await new Promise((r) => setTimeout(r, 10));
    expect(mailer.sent.map((m) => m.to[0])).toEqual(["l1@example.com"]);
  });
});

describe("the reply address and one person, one reply (E3, E4)", () => {
  it("replyAddressOf: the form email; a typo falls back to the account email; a phone as Email is none; never a guessed repair", () => {
    expect(replyAddressOf({ email: "ann@corp.example", accountEmail: "ann@corp.example" })).toMatchObject({ address: "ann@corp.example", source: "account" });
    expect(replyAddressOf({ email: "almir@almirsolutions.vom", accountEmail: "almir@gmail.com" })).toMatchObject({ address: "almir@gmail.com", source: "account" });
    expect(replyAddressOf({ email: "almir@almirsolutions.vom", accountEmail: null })).toMatchObject({ address: null });
    expect(replyAddressOf({ email: null, accountEmail: "+49 151 2345678" })).toMatchObject({ address: null });
    expect(replyAddressOf({ email: "r@reichenbach.example", accountEmail: "+49 151 2345678" })).toMatchObject({ address: "r@reichenbach.example", source: "form" });
  });

  it("an older request of a person with a newer row is not_now 'same person as', by phone too; no usable address is hand_over", async () => {
    await repos.leadRows.sync([lead(1, { email: null, phone: "+49 151 2345678" }), lead(2, { email: "d@auto.example", phone: "0049-151-2345678".replace("0049-", "+49 ") }), lead(3, { email: "x@typo.vom" })], NOW);
    const one = await repos.leadRows.get("acme", page(1));
    const two = await repos.leadRows.get("acme", page(2));
    const three = await repos.leadRows.get("acme", page(3));
    expect(await mechanical(repos, "acme", one!)).toMatchObject({ decision: "not_now", reason: expect.stringMatching(/^same person as Lead 2/) });
    expect(await mechanical(repos, "acme", two!)).toBeNull();
    expect(await mechanical(repos, "acme", three!)).toMatchObject({ decision: "hand_over", reason: expect.stringMatching(/^no usable address/) });
  });
});
