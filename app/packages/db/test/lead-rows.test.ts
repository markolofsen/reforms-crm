import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "../src/client";
import { createRepos, type Repos } from "../src/repos";
import type { NewLead } from "../src/repos/lead-rows";

// P97 S2 (migration 0033): the Leads reader's rows and the Inbox's Leads group.
let h: DbHandle;
let repos: Repos;
beforeEach(() => {
  h = openDb(":memory:");
  repos = createRepos(h.db);
});
afterEach(() => h.close());

const NOW = new Date("2026-11-21T10:00:00.000Z");
const lead = (pageId: string, o: Partial<NewLead> = {}): NewLead => ({ project: "p", pageId, name: "KodaCar", email: "kobo@x.test", accountEmail: "kobo@x.test", brand: "Carapis", receivedAt: "2026-11-20T10:00:00.000Z", preview: "We need the API", notionStatus: "New", hasClient: false, ...o });
const FROM = "2026-11-07T10:00:00.000Z";

describe("leadRows", () => {
  it("stores a page once, by its normalised id, and follows what Notion holds now", async () => {
    expect(await repos.leadRows.sync([lead("41806f30-6f14-812a-8a42-000b3b9c3ee4")], NOW)).toBe(1);
    expect(await repos.leadRows.sync([lead("41806f306f14812a8a42000b3b9c3ee4", { notionStatus: "In progress", preview: "x".repeat(300) })], NOW)).toBe(0);
    const row = await repos.leadRows.get("p", "41806f306f14812a8a42000b3b9c3ee4");
    expect(row).toMatchObject({ notionStatus: "In progress", open: false });
    expect(row?.preview).toHaveLength(120);
  });

  it("the group: New or empty, in the window, one row per person with the count of requests", async () => {
    await repos.leadRows.sync([lead("a".repeat(32)), lead("b".repeat(32), { receivedAt: "2026-11-19T10:00:00.000Z" }), lead("c".repeat(32), { email: "old@x.test", accountEmail: null, receivedAt: "2026-10-01T10:00:00.000Z" }), lead("d".repeat(32), { email: null, accountEmail: null, notionStatus: null, name: "Phone only" })], NOW);
    const open = await repos.leadRows.open("p", FROM);
    expect(open.map((r) => [r.pageId[0], r.requests])).toEqual([["d", 1], ["a", 2]]);
    expect(await repos.leadRows.openCount("p", FROM)).toBe(2);
  });

  it("Not now and Spam leave the group, Undo brings the row back; a draft to the address after it closes it", async () => {
    await repos.leadRows.sync([lead("a".repeat(32))], NOW);
    await repos.leadRows.dismiss("p", "a".repeat(32), "spam", NOW);
    expect(await repos.leadRows.open("p", FROM)).toEqual([]);
    expect((await repos.leadRows.get("p", "a".repeat(32)))?.dismissedReason).toBe("spam");
    await repos.leadRows.undismiss("p", "a".repeat(32));
    expect(await repos.leadRows.open("p", FROM)).toHaveLength(1);
    await repos.drafts.record({ project: "p", email: "kobo@x.test", name: "KodaCar", subject: "Your Carapis API request", mailRef: "<new1@x.test>" });
    expect(await repos.leadRows.open("p", FROM)).toEqual([]);
  });

  it("the first send's conversion is kept once; its note is the doctor's last note", async () => {
    await repos.leadRows.sync([lead("a".repeat(32))], NOW);
    await repos.leadRows.markConverted("p", ["a".repeat(32)], { clientPageId: null, note: "give the hub integration Insert content" }, NOW);
    await repos.leadRows.markConverted("p", ["a".repeat(32)], { clientPageId: "c1", note: null }, new Date("2026-11-22T00:00:00.000Z"));
    expect(await repos.leadRows.get("p", "a".repeat(32))).toMatchObject({ convertedAt: NOW.toISOString(), clientPageId: "c1", convertNote: null, hasClient: true });
    expect(await repos.leadRows.lastConvertNote("p")).toBeNull();
    expect((await repos.leadRows.ofEmail("p", "KOBO@x.test")).map((r) => r.pageId)).toEqual(["a".repeat(32)]);
  });
});

// P134 verdicts 6-7: Mail ▸ Leads, its four views with their counts and a brand.
describe("leadRows.views", () => {
  it("puts every lead in one view, counts each, and narrows by brand without narrowing the counts", async () => {
    await repos.leadRows.sync(
      [
        lead("a".repeat(32)),
        lead("b".repeat(32), { email: "b@x.test", accountEmail: null, brand: "Reforms" }),
        lead("c".repeat(32), { email: "c@x.test", accountEmail: null }),
        lead("d".repeat(32), { email: "d@x.test", accountEmail: null, notionStatus: "Spam" }),
        lead("e".repeat(32), { email: "e@x.test", accountEmail: null, receivedAt: "2026-10-01T10:00:00.000Z" }),
      ],
      NOW,
    );
    await repos.leadRows.dismiss("p", "c".repeat(32), "not_now", NOW);
    const v = await repos.leadRows.views("p", "new", FROM);
    expect(v.counts).toEqual({ new: 2, not_now: 1, spam: 1, replied: 0 });
    expect(v.brands).toEqual([{ name: "Carapis", count: 1 }, { name: "Reforms", count: 1 }]);
    const reforms = await repos.leadRows.views("p", "new", FROM, { brand: "reforms" });
    expect(reforms.rows.map((r) => r.email)).toEqual(["b@x.test"]);
    expect(reforms.counts.new).toBe(2);
    expect((await repos.leadRows.views("p", "new", FROM, { limit: 1, offset: 1 })).rows).toHaveLength(1);
  });
});
