import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FollowUpBrain, FollowUpTurn } from "@hub/config/follow-ups";
import { createRepos, openDb, type DbHandle, type DueClient, type Repos } from "@hub/db";
import { runSweep, type SweepDeps } from "../../src/follow-ups/sweep";
import { noteChannel } from "../../src/follow-ups/bug-notes";

// P142 F4: one sweep's budgets and stops, on a fake brain (nothing spawns, nothing is sent).

let dir: string;
let h: DbHandle;
let repos: Repos;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-sweep-"));
  h = openDb(path.join(dir, "app.db"));
  repos = createRepos(h.db);
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

const due = (n: number): DueClient[] => Array.from({ length: n }, (_, i) => ({ clientId: i + 1, name: `C${i + 1}`, email: `c${i + 1}@example.test`, ourLastAt: `2026-11-1${i}T09:00:00.000Z`, theirLastAt: null, lastChannel: "mail", chats: [], onRequest: false, plan: null }));

function deps(clients: DueClient[], brain: FollowUpBrain, limits: SweepDeps["limits"] = {}): SweepDeps & { seen: FollowUpTurn[] } {
  const seen: FollowUpTurn[] = [];
  const r: Repos = { ...repos, followUps: { ...repos.followUps, due: async () => ({ clients, unlinkedWroteLast: 0 }) } } as Repos;
  return { repos: r, brain: { name: brain.name, turn: async (t, s) => (seen.push(t), brain.turn(t, s)) }, prefetch: { project: () => undefined }, limits: { slotPollMs: 1, ...limits }, seen };
}

describe("runSweep", () => {
  it("one turn per listed client, counted by decision, and one finished row", async () => {
    const d = deps(due(3), { name: "test", turn: async (t) => ({ kind: "decided", decision: t.client === 2 ? "stop" : "wait", nudge: null, costUsd: null }) });
    const row = await runSweep(d, "acme", "button");
    expect(d.seen.map((t) => t.client)).toEqual([1, 2, 3]);
    expect(row).toMatchObject({ listed: 3, turns: 3, waited: 2, stopped: 1, failed: 0, skipped: 0, error: null, trigger: "button" });
    expect(row?.finishedAt).toEqual(expect.any(String));
  });

  it("stops at the sweep's budget and rolls the rest; the Mac's daily budget counts earlier sweeps", async () => {
    const wait: FollowUpBrain = { name: "test", turn: async () => ({ kind: "decided", decision: "wait", nudge: null, costUsd: null }) };
    expect(await runSweep(deps(due(4), wait, { sweepTurns: 2 }), "acme", "schedule")).toMatchObject({ turns: 2, skipped: 2, error: null });
    // 2 turns used today: a daily budget of 3 leaves room for 1.
    expect(await runSweep(deps(due(4), wait, { instanceTurns: 3 }), "acme", "schedule")).toMatchObject({ turns: 1, skipped: 3 });
    expect(await runSweep(deps(due(2), wait, { instanceTurns: 3 }), "acme", "schedule")).toMatchObject({ turns: 0, error: expect.stringMatching(/used up/) });
  });

  it("three failed turns in a row stop the sweep with the reason; an undecided turn is skipped", async () => {
    const failing = deps(due(5), { name: "test", turn: async () => { throw new Error("claude exited 1"); } });
    expect(await runSweep(failing, "acme", "schedule")).toMatchObject({ turns: 3, failed: 3, skipped: 2, error: expect.stringMatching(/3 turns failed in a row: claude exited 1/) });
    expect(await runSweep(deps(due(1), { name: "test", turn: async () => ({ kind: "undecided", reason: "no plan", costUsd: null }) }), "acme", "schedule")).toMatchObject({ turns: 1, skipped: 1, error: null });
  });
});

// P145 B4: a fixed bug's note, before the silent clients and in the same budget; its draft joins the day's lead batch, a turn
// that wrote nothing gives the claim back, the send stamps `told_at`, and `Client told` is written once the report's clients were told.
describe("a fixed bug's note (P145 B4)", () => {
  const report = { pageId: "report-1", symptom: "Gallery shows another car's photos", words: "the photos are of other cars", channel: "Mail" as const, clients: ["client-page-1"] };

  async function noteDeps(brain: FollowUpBrain, told: Array<[string, string]> = []) {
    const clientId = await repos.clients.create({ project: "acme", email: "ana@example.test", name: "Ana" });
    const client: DueClient = { clientId, name: "Ana", email: "ana@example.test", ourLastAt: "2026-11-01T09:00:00.000Z", theirLastAt: null, lastChannel: "mail", chats: [], onRequest: false, plan: null };
    const d = deps(due(0), brain);
    d.repos = { ...d.repos, clients: { ...repos.clients, findByNotionPage: async (_p: string, page: string) => (page === "client-page-1" ? clientId : undefined) }, followUps: { ...d.repos.followUps, noteClient: async () => client } } as Repos;
    d.bugReports = { read: async () => ({ state: "ok", reports: [report] }), told: async (_s, pageId, at) => (told.push([pageId, at]), { state: "written" }) };
    return { d, clientId, told };
  }

  it("drafts one note per (report, client) bound to its claim, never twice, and Client told waits for the send", async () => {
    const brain: FollowUpBrain = {
      name: "test",
      turn: async (t) => {
        if (t.bugNote) await repos.drafts.record({ project: "acme", email: "ana@example.test", name: "Ana", subject: "Fixed: the gallery", mailRef: "<n1@x>", skill: "follow-up-sweep", ownerRequest: "fixed bug note", context: {}, bugNote: { noteId: t.bugNote.id, day: "2026-11-25" } });
        return { kind: "decided", decision: "nudge", nudge: null, costUsd: null };
      },
    };
    const { d, told } = await noteDeps(brain);
    expect(await runSweep(d, "acme", "button")).toMatchObject({ turns: 1, error: null });
    expect(d.seen.map((t) => t.bugNote?.channel)).toEqual(["mail"]);
    expect(d.seen[0]?.context).toContain("Fixed report: Gallery shows another car's photos");
    const [note] = await repos.bugNotes.ofBatch("acme", (await repos.drafts.get((await repos.bugNotes.get(1))?.draftId as number))?.batchId as number);
    expect(note).toMatchObject({ reportPageId: "report-1", channel: "mail", toldAt: null });
    // Not told yet: Notion is not written; the next sweep does not draft it again.
    expect(told).toEqual([]);
    expect(await runSweep(d, "acme", "button")).toMatchObject({ turns: 0 });
    // The send stamps it; the next sweep writes Client told with the send's time, once.
    await repos.bugNotes.told(note?.id as number, "2026-11-25T12:00:00.000Z");
    await runSweep(d, "acme", "button");
    await runSweep(d, "acme", "button");
    expect(told).toEqual([["report-1", "2026-11-25T12:00:00.000Z"]]);
  });

  it("a turn that wrote no draft gives its claim back, so the next sweep tries again", async () => {
    const { d } = await noteDeps({ name: "test", turn: async () => ({ kind: "undecided", reason: "no plan", costUsd: null }) });
    await runSweep(d, "acme", "button");
    expect(await repos.bugNotes.known("acme", ["report-1"])).toEqual(new Set());
    await runSweep(d, "acme", "button");
    expect(d.seen.filter((t) => t.bugNote)).toHaveLength(2);
  });
});

describe("noteChannel (P145 B4)", () => {
  const c = (o: Partial<Pick<DueClient, "email" | "chats" | "lastChannel">>) => ({ email: null, chats: [], lastChannel: "mail" as const, ...o }) as Pick<DueClient, "email" | "chats" | "lastChannel">;
  const chat = (channel: "whatsapp" | "telegram_user") => ({ channel }) as DueClient["chats"][number];
  it("the report's channel when the client has it, else the last channel, else whatever they have", () => {
    expect(noteChannel({ channel: "WhatsApp" }, c({ email: "a@x.test", chats: [chat("whatsapp")] }))).toBe("whatsapp");
    expect(noteChannel({ channel: "WhatsApp" }, c({ email: "a@x.test" }))).toBe("mail");
    expect(noteChannel({ channel: null }, c({ chats: [chat("telegram_user")], lastChannel: "telegram_user" }))).toBe("telegram");
    expect(noteChannel({ channel: "Mail" }, c({}))).toBeNull();
  });
});
