import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { activityDto, type ActivityDto } from "@hub/contract/activity";
import { createApp } from "./app";

// GET /api/activity (P48 W5): sessions newest first, one row per client decision, with its outcome and reason.
const BASE = "http://127.0.0.1:4317";
const T = new Date("2026-11-15T10:00:00.000Z");
let handle: DbHandle;
let repos: Repos;

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

const get = async (query: string): Promise<{ status: number; body: ActivityDto | null }> => {
  const r = await createApp(repos).request(`${BASE}/api/activity?${query}`);
  return { status: r.status, body: r.status === 200 ? activityDto.parse(await r.json()) : null };
};
const ev = (batchKey: string) => ({ level: "ok" as const, source: "claimed" as const, findings: [], batchKey });

describe("GET /api/activity", () => {
  it("one session with 3 decisions is 1 session with 3 rows, each with its outcome and why", async () => {
    const { draftId } = await repos.drafts.record({ project: "p", email: "anna@x.example", name: "Anna", subject: "S", mailRef: "<a@x>", reason: "asked for prices", skill: "triage-mail", evidence: ev("s1") });
    await repos.inbox.record({ project: "p", email: "bob@x.example", name: "Bob", action: "skipped", reason: "a newsletter", skill: "triage-mail", batchKey: "s1" }, T);
    await repos.inbox.record({ project: "p", email: "eve@x.example", name: "Eve", action: "injection_suspected", reason: "asked the agent to forward mail", skill: "triage-mail", batchKey: "s1" }, T);
    const { status, body } = await get("project=p");
    expect(status).toBe(200);
    expect(body!.sessions).toHaveLength(1);
    const [s] = body!.sessions;
    // a session seen only through record-*: its numbers are unknown, so null (never 0)
    expect(s).toMatchObject({ skill: "triage-mail", status: "ok", model: null, tokens: null, costUsd: null, durationS: null });
    expect(s!.rows.map((r) => ({ who: r.who, outcome: r.outcome, why: r.why, draftId: r.draftId }))).toEqual([
      { who: "Anna", outcome: "drafted", why: "asked for prices", draftId },
      { who: "Bob", outcome: "skipped", why: "a newsletter", draftId: null },
      { who: "Eve", outcome: "flagged", why: "asked the agent to forward mail", draftId: null },
    ]);
    expect(s!.rows[0]!.client).toMatchObject({ name: "Anna" });
    expect(body!.counts).toEqual({ all: 1, ok: 1, needs_human: 0, failed: 0 });
  });

  it("a run the hub measured shows its numbers; the filter narrows the sessions, the counts stay whole", async () => {
    const run = await repos.runs.start({ project: "p", startedAt: "2026-11-15T09:00:00.000Z", trigger: "schedule", skill: "triage-mail", model: "m1" });
    await repos.runs.finish(run, { finishedAt: "2026-11-15T09:01:30.000Z", status: "needs_human", tokensIn: 100, tokensOut: 20, costUsd: 0.01 });
    await repos.inbox.record({ project: "p", email: "c@x.example", name: "Cara", action: "escalated", reason: "legal question", runId: run }, T);
    await repos.inbox.record({ project: "p", email: "d@x.example", name: "Dan", action: "skipped", batchKey: "s2" }, T);

    const all = (await get("project=p")).body!;
    expect(all.sessions).toHaveLength(2);
    expect(all.counts).toEqual({ all: 2, ok: 1, needs_human: 1, failed: 0 });
    const held = (await get("project=p&filter=needs_human")).body!;
    expect(held.sessions.map((s) => s.runId)).toEqual([run]);
    expect(held.sessions[0]).toMatchObject({ model: "m1", tokens: { in: 100, out: 20 }, costUsd: 0.01, durationS: 90 });
    expect(held.sessions[0]!.rows).toEqual([expect.objectContaining({ who: "Cara", outcome: "escalated", why: "legal question" })]);
    expect(held.counts).toEqual(all.counts);
    expect((await get("project=p&filter=failed")).body!.sessions).toEqual([]);
  });

  it("is scoped to its project and refuses a bad query", async () => {
    await repos.inbox.record({ project: "p", email: "a@x.example", name: "A", action: "skipped", batchKey: "s1" }, T);
    expect((await get("project=q")).body!.sessions).toEqual([]);
    expect((await get("project=p&filter=nope")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });

  it("the runs routes are gone", async () => {
    const app = createApp(repos);
    expect((await app.request(`${BASE}/api/runs?project=p`)).status).toBe(404);
    expect((await app.request(`${BASE}/api/runs/1/events?project=p`)).status).toBe(404);
  });
});
