import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb } from "@hub/db";
import { doctorProject, loadProject, loadProjects } from "@hub/projects";
import { FakeMailer } from "@hub/send";
import { defaultRoot } from "../src/context";
import { recordClient } from "../src/record-client";
import { recordDraft } from "../src/record-draft";
import { inAgentSession, runSequencesCheck, runSequencesDue, runSequencesEnrol, runSequencesJudge, runSequencesPauseResume, runSequencesStop } from "../src/sequences-command";

// P47 W1 acceptance in a throw-away instance: project `alpha` (a copy of the acme-travel fixture, recipients = any) with the
// core's starter sequences, a database seeded with one client we wrote to 10 days ago. Nothing reaches Mail.

const ROOT = defaultRoot();
const STARTER = path.join(ROOT, "app", "projects", "_template", "sequences");
const NOW = new Date("2026-11-30T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const OWNER_ENV: NodeJS.ProcessEnv = {};

let db: string;
let projects: string;
let lines: string[];
const deps = (env: NodeJS.ProcessEnv = OWNER_ENV) => ({ projectsDir: projects, dbPath: db, out: (l: string) => void lines.push(l), now: () => NOW, env });
const last = () => JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;
const repos = async <T>(fn: (r: ReturnType<typeof createRepos>) => Promise<T>) => {
  const h = openDb(db);
  try {
    return await fn(createRepos(h.db));
  } finally {
    h.close();
  }
};

beforeEach(async () => {
  const d = mkdtempSync(path.join(tmpdir(), "hub-seq-cli-"));
  db = path.join(d, "app.db");
  projects = path.join(d, "projects");
  cpSync(path.join(ROOT, "app", "packages", "projects", "test", "fixtures", "projects", "acme-travel"), path.join(projects, "alpha"), { recursive: true });
  const pm = path.join(projects, "alpha", "project.md");
  writeFileSync(pm, readFileSync(pm, "utf8").replace("| draft.recipients | test |", "| draft.recipients | any |"));
  cpSync(STARTER, path.join(projects, "alpha", "sequences"), { recursive: true });
  lines = [];
  await repos(async (r) => {
    const clientId = await r.clients.create({ project: "alpha", email: "quiet@example.com", name: "Quinn Quiet", repliesOwed: false, lastContactAt: daysAgo(12) });
    await r.drafts.create({ project: "alpha", clientId, subject: "Re: your enquiry", toAddr: "quiet@example.com", body: "b", status: "sent", sentAt: daysAgo(10), mailRef: "<enquiry-1@example.com>", sentMessageId: "<our-answer@example.com>", mailClass: "client" });
  });
});

describe("hub sequences check", () => {
  it("passes the starter pack and exits 1 on a bad file, naming it", () => {
    expect(runSequencesCheck("alpha", deps())).toBe(0);
    expect(lines.at(-1)).toBe("alpha: 2 sequence(s) ok");
    writeFileSync(path.join(projects, "alpha", "sequences", "bad.md"), "---\nname: Bad\nstatus: Live\n---\n# Bad\n");
    lines = [];
    expect(runSequencesCheck("alpha", deps())).toBe(1);
    expect(lines.join("\n")).toMatch(/error sequences\/bad\.md: status "Live"/);
  });
  it("refuses a mail class the project's kind does not have", () => {
    const f = path.join(projects, "alpha", "sequences", "proposal-sent-no-reply.md");
    writeFileSync(f, readFileSync(f, "utf8").replace('mail_classes: ["client"]', 'mail_classes: ["invoices"]'));
    expect(runSequencesCheck("alpha", deps())).toBe(1);
    expect(lines.join("\n")).toMatch(/mail class "invoices" is not a class of kind generic/);
  });
  it("the project doctor has the sequences parse row", async () => {
    const p = loadProject(projects, "alpha");
    const checks = await doctorProject({ project: p, all: loadProjects(projects) });
    expect(checks.find((c) => c.name === "sequences parse")).toMatchObject({ outcome: "pass", detail: "2 sequence(s), 0 active" });
  });
});

describe("enrol, due, and a reply (W1 acceptance)", () => {
  it("the owner enrols; `hub sequences due alpha --json` lists the row; a recorded inbound reply finishes it as replied and skips its draft", async () => {
    expect(await runSequencesEnrol("alpha", { client: "quiet@example.com", sequence: "answered-enquiry-no-reply" }, deps())).toBe(0);
    expect(last()).toMatchObject({ ok: true, state: "active", step: 1 });
    lines = [];
    expect(await runSequencesDue("alpha", true, deps())).toBe(0);
    const due = JSON.parse(lines[0] ?? "{}") as { due: Array<Record<string, unknown>> };
    expect(due.due).toEqual([
      expect.objectContaining({
        client: expect.objectContaining({ email: "quiet@example.com" }),
        sequence: "answered-enquiry-no-reply",
        step: 1,
        steps: 3,
        lastStep: false,
        optOut: null,
        replyTo: expect.objectContaining({ mailRef: "<enquiry-1@example.com>", sentMessageId: "<our-answer@example.com>" }),
        stepRow: expect.objectContaining({ n: 1, after: 2 }),
        changedSinceEnrolment: false,
      }),
    ]);
    const enrollmentId = Number(due.due[0]?.enrollmentId);

    // the step draft, as the skill records it
    const step = await recordDraft({ project: "alpha", payload: JSON.stringify({ email: "quiet@example.com", name: "Quinn Quiet", subject: "Re: your enquiry", mailRef: "<our-answer@example.com>", skill: "sequence-drafts", repliesOwed: false, sequence: { enrollmentId, step: 1 } }), dbPath: db, attempts: 1, projectsDir: projects });
    expect(JSON.parse(step.line)).toMatchObject({ ok: true, action: "created" });
    // the client writes back; triage records the client
    const reply = await recordClient({ project: "alpha", payload: JSON.stringify({ email: "quiet@example.com", action: "escalated", skill: "triage-mail", notion: { kind: "none" }, lastInboundAt: NOW.toISOString() }), dbPath: db });
    expect(JSON.parse(reply.line), reply.line).toMatchObject({ ok: true, followUps: "replied" });
    await repos(async (r) => {
      expect(await r.enrollments.get("alpha", enrollmentId)).toMatchObject({ state: "finished", finishReason: "replied" });
      expect((await r.drafts.get(JSON.parse(step.line).draftId as number))?.status).toBe("skipped");
    });
  });

  it("record-draft: the sequence block needs the sequence skill and the open step; without it a draft is an ordinary one", async () => {
    await runSequencesEnrol("alpha", { client: "quiet@example.com" }, deps());
    const id = Number(last().enrollmentId);
    const base = { email: "quiet@example.com", name: "Q", subject: "Re: x", mailRef: "<m1>" };
    const rec = (p: object) => recordDraft({ project: "alpha", payload: JSON.stringify(p), dbPath: db, attempts: 1, projectsDir: projects });
    expect((await rec({ ...base, skill: "triage-mail", sequence: { enrollmentId: id, step: 1 } })).code).toBe(2);
    expect(JSON.parse((await rec({ ...base, skill: "sequence-drafts", sequence: { enrollmentId: id, step: 2 } })).line)).toMatchObject({ ok: false, code: "wrong_state" });
    expect((await rec({ ...base, skill: "sequence-drafts", sequence: { enrollmentId: id, step: 1, extra: true } })).code).toBe(2);
    const plain = JSON.parse((await rec({ ...base, mailRef: "<m2>", skill: "sequence-drafts" })).line) as Record<string, unknown>;
    expect(plain).toMatchObject({ ok: true, action: "created" });
    expect(plain.followUps).toBeUndefined();
  });

  it("stop and judge reduce mail for anyone; enrol, pause and resume refuse an agent session", async () => {
    const agent = { CLAUDECODE: "1" };
    expect(inAgentSession(agent)).toBe(true);
    expect(inAgentSession({ HUB_PROJECT: "alpha" })).toBe(true);
    expect(inAgentSession({})).toBe(false);
    expect(await runSequencesEnrol("alpha", { client: "quiet@example.com" }, deps(agent))).toBe(2);
    expect(String(last().error)).toMatch(/owner's step/);
    expect(await runSequencesEnrol("alpha", { client: "quiet@example.com" }, deps())).toBe(0);
    expect(await runSequencesPauseResume("alpha", { client: "quiet@example.com" }, "pause", deps(agent))).toBe(2);
    expect(await runSequencesPauseResume("alpha", { client: "quiet@example.com" }, "pause", deps())).toBe(0);
    expect(await runSequencesPauseResume("alpha", { client: "quiet@example.com" }, "resume", deps({ HUB_PROJECT: "alpha" }))).toBe(2);
    expect(await runSequencesPauseResume("alpha", { client: "quiet@example.com" }, "resume", deps())).toBe(0);
    // judge: an out-of-office delays, a reply after our anchor finishes
    expect(await runSequencesJudge("alpha", { client: "quiet@example.com" }, JSON.stringify({ outOfOfficeUntil: "2026-12-11" }), deps(agent))).toBe(0);
    expect(last()).toMatchObject({ ok: true, decision: { action: "delay" }, state: "active" });
    expect(await runSequencesJudge("alpha", { client: "quiet@example.com" }, JSON.stringify({ lastInboundAt: NOW.toISOString() }), deps(agent))).toBe(0);
    expect(last()).toMatchObject({ ok: true, decision: { action: "finish", reason: "replied" }, state: "finished" });
    expect(await runSequencesStop("alpha", { client: "quiet@example.com" }, deps(agent))).toBe(1); // nothing open any more
    expect(await runSequencesJudge("alpha", { client: "quiet@example.com" }, "{\"unknown\":1}", deps(agent))).toBe(2);
  });
});

describe("a dry sequence-drafts session on the alpha fixture (W2 acceptance, fake mailer)", () => {
  it("one recorded step draft per due row with evidence ok, and nothing sent", async () => {
    await repos(async (r) => {
      const c2 = await r.clients.create({ project: "alpha", email: "second@example.com", name: "Sam Second", repliesOwed: false, lastContactAt: daysAgo(9) });
      await r.drafts.create({ project: "alpha", clientId: c2, subject: "Re: prices", toAddr: "second@example.com", body: "b", status: "done", actedAt: daysAgo(7), mailRef: "<prices-1@example.com>", mailClass: "client" });
    });
    for (const client of ["quiet@example.com", "second@example.com"]) expect(await runSequencesEnrol("alpha", { client }, deps())).toBe(0);
    lines = [];
    await runSequencesDue("alpha", true, deps({ CLAUDECODE: "1" }));
    const due = (JSON.parse(lines[0] ?? "{}") as { due: Array<{ enrollmentId: number; step: number; client: { email: string; name: string }; replyTo: { mailRef: string | null; sentMessageId: string | null } | null }> }).due;
    expect(due).toHaveLength(2);
    const mailer = new FakeMailer();
    const results = [];
    for (const row of due) {
      // what the session does per row (P1 to P7 read, then a create_reply in Mail, then this record): no Mail call is a send
      const context = { batchKey: "seq-2026-11-30-abc", thread: { firstContact: false, found: 3, read: 3, readIds: [1, 2, 3], cited: [1], newest: "2026-11-20" }, profile: { read: true, state: "filled" }, facts: { queries: 1, used: [], missing: [] }, anchors: [`the enquiry of ${row.client.name}`], personalization: `Picks up ${row.client.name}'s own question from our last answer and adds one new detail.` };
      const r = await recordDraft({ project: "alpha", payload: JSON.stringify({ email: row.client.email, name: row.client.name, subject: "Re: your enquiry", mailRef: row.replyTo?.sentMessageId ?? row.replyTo?.mailRef ?? "<none>", skill: "sequence-drafts", repliesOwed: false, context, sequence: { enrollmentId: row.enrollmentId, step: row.step } }), dbPath: db, attempts: 1, projectsDir: projects, now: () => NOW });
      results.push(JSON.parse(r.line) as { ok: boolean; evidence: string; action: string });
    }
    expect(results.map((r) => [r.ok, r.action, r.evidence])).toEqual([[true, "created", "ok"], [true, "created", "ok"]]);
    expect(mailer.sent).toEqual([]);
    await repos(async (r) => {
      expect((await r.clients.review("alpha", "sequences")).map((d) => d.sequence?.step)).toEqual([1, 1]);
      expect(await r.enrollments.list("alpha", "due", NOW)).toEqual([]);
      expect((await r.sends.queued()).length).toBe(0);
    });
  });
});

