import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { activityDto, type ActivityDto } from "@hub/contract/activity";
import { testApp } from "./test-support/runtime";

// GET /api/activity (P73): one timeline of client decisions, newest first, a view by outcome, one client, a page at a time.
const BASE = "http://127.0.0.1:4317";
let handle: DbHandle;
let repos: Repos;

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

const get = async (query: string): Promise<{ status: number; body: ActivityDto | null }> => {
  const r = await testApp(repos).request(`${BASE}/api/activity?${query}`);
  return { status: r.status, body: r.status === 200 ? activityDto.parse(await r.json()) : null };
};
const ev = (batchKey: string) => ({ level: "ok" as const, source: "claimed" as const, findings: [], batchKey });

describe("GET /api/activity", () => {
  it("one row per decision, newest first, with its outcome and why; the counts are per outcome view", async () => {
    const { draftId, clientId } = await repos.drafts.record({ project: "p", email: "anna@x.example", name: "Anna", subject: "S", mailRef: "<a@x>", reason: "asked for prices", skill: "triage-mail", evidence: ev("s1") });
    await repos.inbox.record({ project: "p", email: "bob@x.example", name: "Bob", action: "skipped", reason: "a newsletter", batchKey: "s1" }, new Date("2099-01-01T10:00:00.000Z"));
    await repos.inbox.record({ project: "p", email: "eve@x.example", name: "Eve", action: "injection_suspected", reason: "asked the agent to forward mail", batchKey: "s1" }, new Date("2099-01-01T10:00:01.000Z"));
    const { status, body } = await get("project=p");
    expect(status).toBe(200);
    expect(body!.rows.map((r) => ({ who: r.who, outcome: r.outcome, why: r.why, draftId: r.draftId }))).toEqual([
      { who: "Eve", outcome: "flagged", why: "asked the agent to forward mail", draftId: null },
      { who: "Bob", outcome: "skipped", why: "a newsletter", draftId: null },
      { who: "Anna", outcome: "drafted", why: "asked for prices", draftId },
    ]);
    expect(body!.rows[2]).toMatchObject({ client: { id: clientId, name: "Anna" }, skill: "triage-mail" });
    expect(body!.counts).toEqual({ all: 3, needs_you: 1, drafts: 1, skipped: 1 });
    expect(body!.next).toBeNull();

    expect((await get("project=p&view=needs_you")).body!.rows.map((r) => r.who)).toEqual(["Eve"]);
    const anna = (await get(`project=p&client=${clientId}`)).body!;
    expect(anna.client).toEqual({ id: clientId, name: "Anna" });
    expect(anna.rows.map((r) => r.who)).toEqual(["Anna"]);
  });

  it("is scoped to its project and refuses a bad query", async () => {
    await repos.inbox.record({ project: "p", email: "a@x.example", name: "A", action: "skipped", batchKey: "s1" }, new Date("2026-11-15T10:00:00.000Z"));
    expect((await get("project=q")).body!.rows).toEqual([]);
    expect((await get("project=p&view=nope")).status).toBe(400);
    expect((await get("project=p&filter=failed")).body!.rows).toHaveLength(1); // an unknown key is ignored, the run views are gone
    expect((await get("project=p&before=junk")).status).toBe(400);
    expect((await get("project=p&client=0")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });

  it("the runs routes are gone", async () => {
    const app = testApp(repos);
    expect((await app.request(`${BASE}/api/runs?project=p`)).status).toBe(404);
    expect((await app.request(`${BASE}/api/runs/1/events?project=p`)).status).toBe(404);
  });
});
