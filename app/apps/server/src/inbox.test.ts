import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inboxDto } from "@hub/contract/responses";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { createApp } from "./app";

let handle: DbHandle;
let repos: Repos;
beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

const get = async (q: string) => createApp(repos).request(`http://127.0.0.1:4317/api/inbox?${q}`);

describe("GET /api/inbox", () => {
  it("says plainly that nothing was ever recorded", async () => {
    const r = await get("project=p");
    expect(r.status).toBe(200);
    expect(inboxDto.parse(await r.json())).toMatchObject({ rows: [], total: 0, lastTriageAt: null, counts: { owed: 0, new: 0, all: 0 } });
  });

  it("lists the owed rows first with their Notion kind, and never a body", async () => {
    await repos.inbox.record({ project: "p", email: "a@x.example", name: "Ann", action: "skipped", reason: "list", notion: { kind: "none" } });
    await repos.inbox.record({ project: "p", email: "b@x.example", name: "Bo", action: "escalated", reason: "legal", notion: { kind: "lead", pageId: "0123456789abcdef0123456789abcdef" } });
    const body = inboxDto.parse(await (await get("project=p")).json());
    expect(body.rows.map((r) => r.email)).toEqual(["b@x.example"]);
    expect(body.rows[0]).toMatchObject({ owed: true, notionKind: "lead", action: "escalated" });
    expect(Object.keys(body.rows[0] ?? {})).not.toContain("body");
    expect(body.counts).toEqual({ owed: 1, new: 2, all: 2 });
    expect(inboxDto.parse(await (await get("project=p&filter=all")).json()).rows).toHaveLength(2);
  });

  it("is scoped to the project and refuses a bad filter", async () => {
    await repos.inbox.record({ project: "p", email: "a@x.example", name: "Ann", action: "escalated" });
    expect(inboxDto.parse(await (await get("project=other")).json()).rows).toEqual([]);
    expect((await get("project=p&filter=x")).status).toBe(400);
  });
});
