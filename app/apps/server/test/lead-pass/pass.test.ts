import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LeadPassBrain, LeadPassTurn } from "@hub/config/lead-pass";
import { fakeLeadPassBrain } from "@hub/agent/lead-pass";
import { createRepos, openDb, type DbHandle, type NewLead, type Repos } from "@hub/db";
import { runPass } from "../../src/lead-pass/pass";

// P147 L4: one pass on the fake brain (no model, no Mail): the list, the day's lead batch, the re-check before each turn, the
// budgets and three failures in a row.

let dir: string;
let h: DbHandle;
let repos: Repos;
const NOW = new Date();
const received = (h0: number) => new Date(NOW.getTime() - h0 * 3_600_000).toISOString();
const lead = (n: number, o: Partial<NewLead> = {}): NewLead => ({ project: "acme", pageId: String(n).repeat(32).slice(0, 32), name: `Lead ${n}`, email: `l${n}@x.test`, accountEmail: null, brand: "Acme", receivedAt: received(n), preview: "We need the API", notionStatus: "New", hasClient: false, ...o });

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-lead-pass-"));
  h = openDb(path.join(dir, "app.db"));
  repos = createRepos(h.db);
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

const deps = (brain: LeadPassBrain, limits = {}) => ({ repos, brain, windowDays: () => 14, prefetch: { project: () => undefined }, limits });

describe("runPass", () => {
  it("decides every open lead once on the fake brain: drafts join one lead batch, junk is a proposal, no address a hand-over", async () => {
    await repos.leadRows.sync([lead(1), lead(2, { facts: { site: "https://bit.ly/x", country: null, segment: null, volume: null } }), lead(3, { email: null })], NOW);
    const row = await runPass(deps(fakeLeadPassBrain({ repos })), "acme", "button");
    expect(row).toMatchObject({ listed: 3, turns: 3, replied: 1, spam: 1, handedOver: 1, failed: 0, error: null });
    expect(row?.batchId).not.toBeNull();
    expect((await repos.batches.get("acme", row?.batchId as number))?.intent).toBe("lead_reply");
    const again = await runPass(deps(fakeLeadPassBrain({ repos })), "acme", "button");
    expect(again).toMatchObject({ listed: 0, turns: 0 });
  });

  it("re-checks each lead before its turn: a second request of the same person, closed by the first draft, is skipped", async () => {
    await repos.leadRows.sync([lead(1), lead(2, { email: "l1@x.test" })], NOW);
    const row = await runPass(deps(fakeLeadPassBrain({ repos })), "acme", "schedule");
    expect(row).toMatchObject({ listed: 2, turns: 1, replied: 1, skipped: 1 });
  });

  it("the pass's turn cap rolls the rest to the next pass, newest first", async () => {
    await repos.leadRows.sync([lead(1), lead(2), lead(3)], NOW);
    const seen: string[] = [];
    const brain: LeadPassBrain = { name: "t", turn: async (t: LeadPassTurn) => { seen.push(t.pageId); await repos.leadPass.decide({ project: t.project, pageId: t.pageId, decision: "hand_over", reason: "test", passId: t.passId, at: NOW.toISOString() }); return { kind: "decided", decision: "hand_over", costUsd: null }; } };
    const row = await runPass(deps(brain, { passTurns: 2 }), "acme", "button");
    expect(row).toMatchObject({ listed: 3, turns: 2, skipped: 1 });
    expect(seen).toEqual([lead(1).pageId, lead(2).pageId]);
  });

  it("three failures in a row stop the pass with its reason; the leads keep no decision", async () => {
    await repos.leadRows.sync([lead(1), lead(2), lead(3), lead(4)], NOW);
    const brain: LeadPassBrain = { name: "t", turn: async () => ({ kind: "failed", code: "failed", detail: "Mail was closed" }) };
    const row = await runPass(deps(brain), "acme", "button");
    expect(row).toMatchObject({ turns: 3, failed: 3, skipped: 1 });
    expect(row?.error).toMatch(/3 turns failed in a row: Mail was closed/);
    expect((await repos.leadPass.due("acme", received(100))).total).toBe(4);
  });
});
