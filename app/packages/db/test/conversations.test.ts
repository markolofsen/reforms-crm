import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "../src/client";
import { createRepos, type Repos } from "../src/repos";
import { brandCounts, stateOf } from "../src/repos/conversations";

let handle: DbHandle;
let repos: Repos;
beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

const P = "p";
const tick = () => new Promise((r) => setTimeout(r, 5));
const record = (email: string, mailRef: string, subject = "Re: Hello", brand?: string) => repos.drafts.record({ project: P, email, name: "Mark Effect", subject, mailRef: `<${mailRef}>`, ...(brand ? { brand } : {}) });
const wrote = (email: string, messageId: string, receivedAt: string, subject = "Re: Wow") =>
  repos.inboundMail.store([{ project: P, account: "hello@x.example", mailbox: "INBOX", messageId, email, name: "Mark Effect", subject, receivedAt, read: false, why: "client", preview: "Are you there?" }]);

describe("P99 the list of people", () => {
  it("one row for a client with four drafts, whatever their states (the owner's screenshot of four cards)", async () => {
    const a = await record("m@x.example", "a@x", "Re: Hello", "Carapis");
    await repos.drafts.markSent(a.draftId, { at: "2026-11-19T14:15:38.000Z", via: "admin", messageId: "s1@x" });
    const b = await record("m@x.example", "b@x", "Re: Hello", "Reforms");
    await repos.drafts.markSent(b.draftId, { at: "2026-11-20T12:06:45.000Z", via: "admin", messageId: "s2@x" });
    const c = await record("m@x.example", "c@x", "Re: Wow", "CMDOP");
    await repos.drafts.markSent(c.draftId, { at: "2026-11-20T15:50:08.000Z", via: "admin", messageId: "s3@x" });
    const d = await record("m@x.example", "d@x", "Re: Wow", "Reforms");
    await repos.drafts.setStatus(d.draftId, "done");
    const all = await repos.conversations.list(P, "all");
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({ client: { email: "m@x.example" }, subject: "Re: Wow", draft: null });
    expect(all.rows[0]?.brands.sort()).toEqual(["CMDOP", "Carapis", "Reforms"]);
    expect(all.counts).toMatchObject({ all: 1, needs_you: 0 });
  });

  it("the state word follows the facts: Draft ready, On hold, Waiting for them, Wrote you", async () => {
    const r = await record("m@x.example", "a@x");
    expect((await repos.conversations.one(P, r.clientId))?.state).toBe("draft");
    await repos.drafts.setStatus(r.draftId, "hold");
    expect((await repos.conversations.one(P, r.clientId))?.state).toBe("hold");
    await repos.drafts.setStatus(r.draftId, "ready");
    await repos.drafts.markSent(r.draftId, { at: "2026-11-20T10:00:00.000Z", via: "admin", messageId: "s1@x" });
    expect((await repos.conversations.one(P, r.clientId))?.state).toBe("waiting");
    // `drafts.created_at` is SQLite's clock, so their message is dated by the real clock, between the two records (a fixed
    // date goes stale: a draft recorded after it closes it, OPEN_INBOUND).
    await tick();
    await wrote("m@x.example", "w1@x", new Date().toISOString());
    await tick();
    const row = await repos.conversations.one(P, r.clientId);
    expect(row).toMatchObject({ state: "wrote", subject: "Re: Wow", preview: "Are you there?" });
    expect(row?.inboundId).not.toBeNull();
    // A draft recorded after their message answers it: Draft ready again, and the preview is the draft's words.
    await record("m@x.example", "w1@x", "Re: Wow");
    expect((await repos.conversations.one(P, r.clientId))?.state).toBe("draft");
  });

  it("Needs you lists Wrote you and Draft ready first, newest activity on top; Waiting and All are their own views", async () => {
    const old = await record("old@x.example", "o@x");
    await repos.drafts.markSent(old.draftId, { at: "2026-11-01T10:00:00.000Z", via: "admin", messageId: "so@x" });
    await record("ready@x.example", "r@x");
    await wrote("new@x.example", "n@x", "2030-01-01T00:00:00.000Z");
    const needs = await repos.conversations.list(P, "needs_you");
    expect(needs.rows.map((r) => [r.client.email, r.state])).toEqual([
      ["new@x.example", "wrote"],
      ["ready@x.example", "draft"],
    ]);
    expect((await repos.conversations.list(P, "waiting")).rows.map((r) => r.client.email)).toEqual(["old@x.example"]);
    expect((await repos.conversations.list(P, "all")).counts).toEqual({ needs_you: 2, waiting: 1, all: 3, sequences: 0 });
    expect((await repos.conversations.list(P, "all", { search: "ready" })).rows.map((r) => r.client.email)).toEqual(["ready@x.example"]);
  });

  it("verdict 1: a sender with an open message gets a clients row once; a lead notice never does; the reader-only one() writes nothing", async () => {
    await wrote("new@x.example", "n@x", "2026-11-21T00:00:00.000Z");
    await repos.inboundMail.store([{ project: P, account: "a", mailbox: "INBOX", messageId: "lead@x", email: "robot@site.example", name: "Robot", subject: "lead", receivedAt: "2026-11-21T00:00:00.000Z", read: false, why: "client", preview: "" }]);
    await repos.inboundMail.dismissWhere(P, (e) => e.startsWith("robot@"), "lead_notice");
    expect(await repos.clients.idByEmail(P, "new@x.example")).toBeUndefined();
    const first = await repos.conversations.list(P, "needs_you");
    expect(first.rows.map((r) => r.client.email)).toEqual(["new@x.example"]);
    const id = await repos.clients.idByEmail(P, "new@x.example");
    expect(id).toBeDefined();
    expect(await repos.clients.idByEmail(P, "robot@site.example")).toBeUndefined();
    await repos.conversations.list(P, "needs_you");
    expect(await repos.clients.idByEmail(P, "new@x.example")).toBe(id);
  });

  it("P128 X2: the agent's escalation or skip travels with a Wrote you row, its reason in its words; a draft after it, or a draft open, drops it", async () => {
    await wrote("phish@x.example", "ph@x", "2026-11-16T00:00:00.000Z", "Access Renewal");
    await repos.inbox.record({ project: P, email: "phish@x.example", name: "Sender", subject: "Access Renewal", action: "escalated", reason: "looks like phishing, owner to confirm" });
    await wrote("quiet@x.example", "q@x", "2026-11-16T00:00:00.000Z");
    const rows = (await repos.conversations.list(P, "needs_you")).rows;
    expect(rows.find((r) => r.client.email === "phish@x.example")?.agent).toMatchObject({ action: "escalated", reason: "looks like phishing, owner to confirm" });
    expect(rows.find((r) => r.client.email === "quiet@x.example")?.agent).toBeNull();
    await tick();
    await record("phish@x.example", "ph@x", "Access Renewal");
    expect((await repos.conversations.list(P, "all")).rows.find((r) => r.client.email === "phish@x.example")?.agent).toBeNull();
  });

  it("stateOf: our send after their message is Waiting; theirs after ours is Done (nothing open); nothing at all is Done", () => {
    expect(stateOf({ wrote: false, open: null, theirLastAt: "2026-11-01", ourLastAt: "2026-11-02" })).toBe("waiting");
    expect(stateOf({ wrote: false, open: null, theirLastAt: "2026-11-03", ourLastAt: "2026-11-02" })).toBe("done");
    expect(stateOf({ wrote: false, open: null, theirLastAt: null, ourLastAt: null })).toBe("done");
    expect(stateOf({ wrote: true, open: "ready", theirLastAt: null, ourLastAt: null })).toBe("wrote");
  });
});

// P134 verdict 4: the brand filter's counts: people per brand, most first, a person with no draft brand counted nowhere.
describe("brandCounts", () => {
  it("counts each person once per brand, most people first, then by name", () => {
    expect(brandCounts([{ brands: ["Reforms", "Carapis"] }, { brands: ["Carapis"] }, { brands: [] }, { brands: ["Akme"] }])).toEqual([
      { name: "Carapis", count: 2 },
      { name: "Akme", count: 1 },
      { name: "Reforms", count: 1 },
    ]);
  });
});
