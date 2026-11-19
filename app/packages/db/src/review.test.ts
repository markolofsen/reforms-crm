import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unresolvedMarkers } from "@hub/config";
import { openDb, type DbHandle } from "./client";
import { createRepos, type Repos } from "./repos";
import { seedMany } from "./seed";

let handle: DbHandle;
let repos: Repos;
beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

const record = (email: string, extra: Partial<Parameters<Repos["drafts"]["record"]>[0]> = {}) =>
  repos.drafts.record({ project: "p", email, name: email.split("@")[0] ?? email, subject: "Re: x", mailRef: `<${email}>`, ...extra });

describe("recorded drafts in the review shape", () => {
  it("carries the client, the typed results and the gate, and pages in a stable order", async () => {
    await record("a@x.example", { repliesOwed: true });
    await record("b@x.example");
    await record("c@x.example");
    const all = await repos.clients.review("p");
    expect(all).toHaveLength(3);
    expect(all[0]?.client).toMatchObject({ email: "a@x.example", repliesOwed: true });
    const second = await repos.clients.review("p", "all", { limit: 1, offset: 1 });
    expect(second.map((d) => d.id)).toEqual([all[1]?.id]);
  });

  it("gates Checked on red results only: amber is shown, a do-not-contact mark blocks until acknowledged", async () => {
    const r = await record("a@x.example", { cc: "boss@x.example" });
    const [amber] = await repos.clients.review("p");
    expect(amber?.safetyResults.map((s) => [s.kind, s.level])).toContainEqual(["cc_present", "amber"]);
    expect(amber?.blocked).toBe(false);
    expect((await repos.drafts.setChecked(r.draftId, true))?.checked).toBe(true);
    await repos.drafts.setChecked(r.draftId, false);

    await repos.clients.setMarks(r.clientId, ["do_not_contact"]);
    const [red] = await repos.clients.review("p");
    expect(red?.blocked).toBe(true);
    await expect(repos.drafts.setChecked(r.draftId, true)).rejects.toMatchObject({ code: "wrong_state" });
    await repos.drafts.acknowledge(r.draftId, "do_not_contact", true);
    expect((await repos.drafts.setChecked(r.draftId, true))?.checked).toBe(true);
  });
});

describe("skip reason", () => {
  it("is kept with a skip, cleared by any other status and by undo, and listed under Skipped", async () => {
    const r = await record("a@x.example");
    expect((await repos.drafts.setStatus(r.draftId, "skipped", "  wrong person "))?.skipReason).toBe("wrong person");
    expect((await repos.clients.review("p", "skipped")).map((d) => d.skipReason)).toEqual(["wrong person"]);
    expect((await repos.clients.counts("p")).skipped).toBe(1);
    expect((await repos.drafts.setStatus(r.draftId, "ready"))?.skipReason).toBeNull();
    await repos.drafts.setStatus(r.draftId, "skipped", "later");
    expect((await repos.drafts.undo(r.draftId))?.skipReason).toBeNull();
  });

  it("a replaced draft says so", async () => {
    const first = await record("a@x.example", { mailRef: "<one@x.example>" });
    await record("a@x.example", { mailRef: "<two@x.example>" });
    expect((await repos.drafts.get(first.draftId))?.skipReason).toBe("Replaced by a newer draft");
  });
});

describe("placeholders left in a text", () => {
  it("counts what a text left unfilled", () => {
    expect(unresolvedMarkers("Hi {first_name}, {price} and [Name: x]")).toEqual(["{first_name}", "{price}", "[Name: x]"]);
  });
});


describe("search and batch scope (P27)", () => {
  it("finds a client that is on the third page of 120 by name, email or subject, and totals the match", async () => {
    await seedMany(repos, { project: "p", count: 120 });
    const page3 = await repos.clients.review("p", "all", { limit: 50, offset: 100 });
    expect(page3).toHaveLength(20);
    const target = page3[0]!.client;
    const hit = await repos.clients.review("p", "all", { limit: 50, offset: 0, search: target.name.toUpperCase() });
    expect(hit.map((d) => d.client.id)).toEqual([target.id]);
    expect(await repos.clients.reviewTotal("p", "all", { search: target.email })).toBe(1);
    expect(await repos.clients.reviewTotal("p", "all", { search: "question 11" })).toBe(10); // Question 110 to 119
    expect(await repos.clients.reviewTotal("p", "all", { search: "100%" })).toBe(0); // a wildcard is a character
    expect((await repos.clients.counts("p")).all).toBe(120); // the counts never narrow by search
  });

  it("a batch id that holds no draft lists nothing (the batch with drafts is covered by e2e/z-batch.spec.ts)", async () => {
    await seedMany(repos, { project: "p", count: 3 });
    expect(await repos.clients.reviewTotal("p", "all", { batch: 9999 })).toBe(0);
    expect(await repos.clients.review("p", "all", { batch: 9999 })).toEqual([]);
  });
});
