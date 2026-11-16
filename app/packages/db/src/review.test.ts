import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markerLeft, unresolvedMarkers } from "@hub/config";
import { openDb, type DbHandle } from "./client";
import { createRepos, type Repos } from "./repos";

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

describe("marker line (P27 M1.3)", () => {
  it("finds the [hub-draft thread=...] line left in a text, and nothing else", () => {
    expect(markerLeft("[hub-draft thread=abc@x.example]\nHi Anna,")).toBe("[hub-draft thread=abc@x.example]");
    expect(markerLeft("Hi Anna,\n\n[Hub-Draft thread=1]\nbye")).toBe("[Hub-Draft thread=1]");
    expect(markerLeft("Hi Anna, a normal reply with [a note] and a hub-draft mention")).toBeNull();
    expect(markerLeft("[Owner: price]")).toBeNull();
    expect(unresolvedMarkers("[hub-draft thread=1]")).toEqual([]);
  });
});
