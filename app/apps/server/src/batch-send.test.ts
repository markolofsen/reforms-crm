import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BATCH_SEND_ACTOR } from "@hub/config";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { setSendPolicy } from "@hub/projects";
import type { MailDraft } from "@hub/mail-app/drafts";
import { FakeMailer, mailHash, planBatch, runBatch, type BatchOutcome, type SendDeps } from "@hub/send";
import { testApp } from "./test-support/runtime";
import { batchRuns } from "./send/batch-door";

// P85b: Send all Checked of one batch. Every test uses FakeMailer: nothing here reaches Mail and nothing is ever sent.

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
  "## Notion databases",
  "",
  "- clients: 00000000-0000-4000-8000-000000000001",
  "",
].join("\n");

let handle: DbHandle;
let repos: Repos;
let mailer: FakeMailer;
let deps: SendDeps;
let dir: string;
const H = { "content-type": "application/json" };
const ADMIN = { ...H, origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" };

const mailOf = (n: number, over: Partial<MailDraft> = {}): MailDraft => ({
  ref: String(500 + n),
  messageId: `d${n}@acme.example`,
  account: "owner@acme.example",
  inReplyTo: `in${n}@x`,
  sender: "Acme <owner@acme.example>",
  to: [`c${n}@example.com`],
  cc: [],
  bcc: [],
  subject: `Re: prices ${n}`,
  body: `Hello ${n},\n\nThe new prices are attached in the text.`,
  attachments: 0,
  ...over,
});

/** A campaign of `n` drafts (one `bulk-drafts` run: one batch), each Checked unless listed, each with its Mail draft. */
async function campaign(n: number, unchecked: number[] = []): Promise<{ batchId: number; ids: number[] }> {
  const ids: number[] = [];
  for (let k = 1; k <= n; k++) {
    const r = await repos.drafts.record({ project: "acme", email: `c${k}@example.com`, name: `Client ${k}`, subject: `Re: prices ${k}`, mailRef: `<in${k}@x>`, skill: "bulk-drafts", ownerRequest: "write to every client about the new prices", evidence: { level: "ok", source: "observed", findings: [], context: { purpose: "prices" }, batchKey: "run-1" } });
    mailer.drafts.push(mailOf(k));
    if (!unchecked.includes(k)) await repos.drafts.setChecked(r.draftId, true);
    ids.push(r.draftId);
  }
  const batchId = (await repos.drafts.get(ids[0] as number))?.batchId as number;
  return { batchId, ids };
}

/** A run control that never waits (it records how long it was asked to) and stops when told to. */
function control(o: { stopAfter?: number } = {}) {
  const waits: number[] = [];
  const updates: BatchOutcome[] = [];
  let sent = 0;
  return {
    waits,
    updates,
    stopped: () => o.stopAfter !== undefined && sent >= o.stopAfter,
    wait: async (ms: number) => void waits.push(ms),
    update: (u: BatchOutcome) => {
      updates.push(u);
      if (u.status === "sent") sent++;
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hub-batch-send-"));
  mkdirSync(join(dir, "projects", "acme"), { recursive: true });
  writeFileSync(join(dir, "projects", "acme", "project.md"), projectMd);
  handle = openDb(join(dir, "app.db"));
  repos = createRepos(handle.db);
  mailer = new FakeMailer();
  const policyDir = join(dir, "state", "projects");
  setSendPolicy(policyDir, "acme", "generic", { "draft.recipients": "any" }, "test");
  deps = { repos, mailer, projectsDir: join(dir, "projects"), policyDir, allowList: [] };
});
afterEach(() => handle.close());

describe("the dry run of a batch send", () => {
  it("lists only the Checked drafts of the batch, each with its recipients and the hash of its Mail text, and sends nothing", async () => {
    const { batchId, ids } = await campaign(3, [2]);
    const plan = await planBatch(deps, "acme", batchId);
    expect(plan?.items.map((i) => i.draftId)).toEqual([ids[0], ids[2]]);
    expect(plan?.items[0]).toMatchObject({ name: "Client 1", to: ["c1@example.com"], subject: "Re: prices 1", hash: mailHash(mailOf(1)) });
    expect(plan?.cap).toEqual({ limit: 50, used: 0, room: 50 });
    expect(mailer.sent).toEqual([]);
    expect(await repos.sends.list("acme")).toEqual([]);
    expect(await planBatch(deps, "other", batchId)).toBeNull();
  });

  it("holds a draft the door refuses (do not contact, test-recipient mode) with its reasons, and drafts past the batch cap", async () => {
    const { batchId, ids } = await campaign(3);
    await repos.clients.setMarks((await repos.drafts.get(ids[0] as number))?.clientId as number, ["do_not_contact"]);
    setSendPolicy(deps.policyDir, "acme", "generic", { "draft.recipients": "test" }, "test");
    const plan = await planBatch({ ...deps, allowList: ["c2@example.com", "c3@example.com"] }, "acme", batchId, { dailyCap: 1, spacingSeconds: 0 });
    expect(plan?.items.map((i) => i.draftId)).toEqual([ids[1]]);
    expect(plan?.held.find((h) => h.draftId === ids[0])?.reasons).toContain("the client is marked do_not_contact");
    expect(plan?.held.find((h) => h.draftId === ids[2])?.reasons[0]).toMatch(/over the batch cap: 0 of 1/);
    const strict = await planBatch(deps, "acme", batchId);
    expect(strict?.held.find((h) => h.draftId === ids[1])?.reasons.join(" ")).toMatch(/draft.recipients of acme does not permit c2@example.com/);
  });
});

describe("a batch run", () => {
  it("sends each confirmed draft through the door, one send_log row each with the batch actor, spaced", async () => {
    const { batchId } = await campaign(3);
    const plan = await planBatch(deps, "acme", batchId);
    // A clock that the run's wait moves on, so the spacing is judged as on a real run.
    let clock = Date.parse("2026-11-20T10:00:00Z");
    const c = control();
    const timed: SendDeps = { ...deps, now: () => new Date(clock) };
    const wait = c.wait;
    c.wait = async (ms) => {
      await wait(ms);
      clock += ms;
    };
    const out = await runBatch(timed, { project: "acme", batchId, items: plan?.items ?? [], limits: { dailyCap: 50, spacingSeconds: 20 }, control: c });
    expect(out.map((o) => o.status)).toEqual(["sent", "sent", "sent"]);
    expect(mailer.sent.map((m) => m.to[0])).toEqual(["c1@example.com", "c2@example.com", "c3@example.com"]);
    const rows = await repos.sends.list("acme");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.actor === BATCH_SEND_ACTOR && r.mode === "manual" && r.status === "sent")).toBe(true);
    // The first mail waits for nothing; each next one waits the spacing from the last attempt.
    expect(c.waits).toEqual([20_000, 20_000]);
  });

  it("does not send a draft changed in Mail after the confirmation, nor one Unchecked since; a failure stops nothing else", async () => {
    const { batchId, ids } = await campaign(3);
    const plan = await planBatch(deps, "acme", batchId);
    mailer.drafts = mailer.drafts.map((m) => (m.to[0] === "c1@example.com" ? { ...m, body: `${m.body}\nP.S. changed` } : m));
    await repos.drafts.setChecked(ids[1] as number, false);
    mailer.failSend = "Mail did not send the message";
    const out = await runBatch(deps, { project: "acme", batchId, items: plan?.items ?? [], limits: { dailyCap: 50, spacingSeconds: 0 }, control: control() });
    expect(out[0]?.status).toBe("refused");
    expect(out[0]?.reasons.join(" ")).toMatch(/changed in Mail/);
    expect(out[1]?.status).toBe("refused");
    expect(out[1]?.reasons).toContain("the draft is not Checked (accepted) yet");
    expect(out[2]?.status).toBe("failed");
    expect(mailer.sent).toEqual([]);
    expect((await repos.sends.list("acme")).map((r) => r.status)).toEqual(["failed"]);
  });

  it("honours Stop of the run and Stop sending between two mails, and the batch cap counted from the log", async () => {
    const { batchId } = await campaign(4);
    const plan = await planBatch(deps, "acme", batchId);
    const stopped = await runBatch(deps, { project: "acme", batchId, items: plan?.items ?? [], limits: { dailyCap: 50, spacingSeconds: 0 }, control: control({ stopAfter: 1 }) });
    expect(stopped.map((o) => o.status)).toEqual(["sent", "stopped", "stopped", "stopped"]);
    await repos.sends.stop("acme");
    const rest = (plan?.items ?? []).slice(1);
    const off = await runBatch(deps, { project: "acme", batchId, items: rest, limits: { dailyCap: 50, spacingSeconds: 0 }, control: control() });
    expect(off.every((o) => o.status === "refused" && o.reasons.includes("Stop all is on"))).toBe(true);
    await repos.sends.resume("acme");
    const capped = await runBatch(deps, { project: "acme", batchId, items: rest, limits: { dailyCap: 2, spacingSeconds: 0 }, control: control() });
    expect(capped.map((o) => o.status)).toEqual(["sent", "refused", "refused"]);
    expect(capped[1]?.reasons[0]).toMatch(/batch cap is reached: 2 of 2/);
    expect(mailer.sent).toHaveLength(2);
  });
});

describe("the batch send routes", () => {
  const appWith = (runs = batchRuns({ limits: { dailyCap: 50, spacingSeconds: 0 } })) =>
    testApp(repos, { sender: { kind: "fake", mailer, projectsDir: deps.projectsDir, policyDir: deps.policyDir, allowList: [], adminPort: 5173, batchRuns: runs, batchLimits: { dailyCap: 50, spacingSeconds: 0 } } });
  const url = (batchId: number) => `http://127.0.0.1:4317/api/projects/acme/batches/${batchId}/send`;

  it("lists a campaign's batch (audience agent, P85) in Drafts' View menu", async () => {
    const { batchId } = await campaign(1);
    const res = await appWith().request("http://127.0.0.1:4317/api/batches?project=acme");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { batches: Array<{ id: number; audience: string }> }).batches).toEqual([expect.objectContaining({ id: batchId, audience: "agent" })]);
  });

  it("the dry run sends nothing; the apply needs the ticket minted for exactly the confirmed drafts and hashes", async () => {
    const { batchId } = await campaign(2);
    const app = appWith();
    const dry = (await (await app.request(url(batchId), { method: "POST", headers: H, body: JSON.stringify({ apply: false }) })).json()) as { items: Array<{ draftId: number; hash: string }> };
    expect(dry.items).toHaveLength(2);
    const items = dry.items.map((i) => ({ draftId: i.draftId, hash: i.hash }));
    // No ticket, a forged one, or one minted for another list: 403, nothing sent.
    expect((await app.request(url(batchId), { method: "POST", headers: H, body: JSON.stringify({ apply: true, items }) })).status).toBe(403);
    const other = (await (await app.request("http://127.0.0.1:4317/api/sends/batch-tickets", { method: "POST", headers: ADMIN, body: JSON.stringify({ project: "acme", batchId, items: items.slice(0, 1) }) })).json()) as { ticket: string };
    expect((await app.request(url(batchId), { method: "POST", headers: H, body: JSON.stringify({ apply: true, items, ticket: other.ticket }) })).status).toBe(403);
    // A ticket only for the admin's exact origin.
    expect((await app.request("http://127.0.0.1:4317/api/sends/batch-tickets", { method: "POST", headers: H, body: JSON.stringify({ project: "acme", batchId, items }) })).status).toBe(403);
    expect(mailer.sent).toEqual([]);
    const t = (await (await app.request("http://127.0.0.1:4317/api/sends/batch-tickets", { method: "POST", headers: ADMIN, body: JSON.stringify({ project: "acme", batchId, items }) })).json()) as { ticket: string };
    const started = await app.request(url(batchId), { method: "POST", headers: H, body: JSON.stringify({ apply: true, items, ticket: t.ticket }) });
    expect(started.status).toBe(202);
    for (let k = 0; k < 50 && mailer.sent.length < 2; k++) await new Promise((r) => setTimeout(r, 10));
    for (let k = 0; k < 50; k++) {
      const s = (await (await app.request(url(batchId))).json()) as { run: { state: string } | null };
      if (s.run?.state !== "running") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const state = (await (await app.request(url(batchId))).json()) as { run: { state: string; items: Array<{ status: string }> } };
    expect(state.run.state).toBe("finished");
    expect(state.run.items.map((i) => i.status)).toEqual(["sent", "sent"]);
    expect(mailer.sent).toHaveLength(2);
  });

  it("refuses an apply whose confirmed text changed in Mail since the dry run", async () => {
    const { batchId } = await campaign(1);
    const app = appWith();
    const dry = (await (await app.request(url(batchId), { method: "POST", headers: H, body: JSON.stringify({ apply: false }) })).json()) as { items: Array<{ draftId: number; hash: string }> };
    const items = dry.items.map((i) => ({ draftId: i.draftId, hash: i.hash }));
    mailer.drafts = mailer.drafts.map((m) => ({ ...m, body: `${m.body} edited` }));
    const t = (await (await app.request("http://127.0.0.1:4317/api/sends/batch-tickets", { method: "POST", headers: ADMIN, body: JSON.stringify({ project: "acme", batchId, items }) })).json()) as { ticket: string };
    const res = await app.request(url(batchId), { method: "POST", headers: H, body: JSON.stringify({ apply: true, items, ticket: t.ticket }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { refused: string[] }).refused[0]).toMatch(/changed in Mail after you confirmed/);
    expect(mailer.sent).toEqual([]);
  });
});
