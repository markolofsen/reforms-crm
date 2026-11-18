import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "./client";
import { createRepos, type Repos } from "./repos";

// Activity (P48 W5): the `record-*` calls of one session join one run by `batchKey`.
let handle: DbHandle;
let repos: Repos;
const T = new Date("2026-11-15T10:00:00.000Z");
const ev = (batchKey: string | null) => ({ level: "ok" as const, source: "claimed" as const, findings: [], batchKey });

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

describe("one session is one run", () => {
  it("3 decisions with one batchKey (draft, skip, escalate) are 1 session with 3 rows", async () => {
    await repos.drafts.record({ project: "p", email: "a@x.example", name: "Anna", subject: "S", mailRef: "<a@x>", reason: "asked for prices", skill: "triage-mail", evidence: ev("s1") });
    await repos.inbox.record({ project: "p", email: "b@x.example", name: "Bob", action: "skipped", reason: "newsletter", skill: "triage-mail", batchKey: "s1" }, T);
    await repos.inbox.record({ project: "p", email: "c@x.example", name: "Cara", action: "escalated", reason: "legal question", skill: "triage-mail", batchKey: "s1" }, T);
    const { sessions, counts } = await repos.runs.activity("p");
    expect(sessions).toHaveLength(1);
    expect(counts.all).toBe(1);
    const [s] = sessions;
    expect(s).toMatchObject({ skill: "triage-mail", model: null, tokens: null, costUsd: null, durationS: null });
    expect(s!.rows.map((r) => [r.who, r.outcome, r.why])).toEqual([
      ["Anna", "drafted", "asked for prices"],
      ["Bob", "skipped", "newsletter"],
      ["Cara", "escalated", "legal question"],
    ]);
  });

  it("another batchKey, or none, starts another run; a key is per project", async () => {
    await repos.inbox.record({ project: "p", email: "a@x.example", name: "A", action: "skipped", batchKey: "s1" }, T);
    await repos.inbox.record({ project: "p", email: "b@x.example", name: "B", action: "skipped", batchKey: "s2" }, T);
    await repos.inbox.record({ project: "p", email: "c@x.example", name: "C", action: "skipped" }, T);
    await repos.inbox.record({ project: "q", email: "d@x.example", name: "D", action: "skipped", batchKey: "s1" }, T);
    expect((await repos.runs.activity("p")).sessions).toHaveLength(3);
    expect((await repos.runs.activity("q")).sessions).toHaveLength(1);
  });
});
