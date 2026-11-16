import { describe, expect, it } from "vitest";
import { createRepos } from "./repos";
import { openDb } from "./client";

const setup = async () => {
  const h = openDb(":memory:");
  const repos = createRepos(h.db);
  const r = await repos.drafts.record({ project: "p", email: "c@example.com", name: "C", subject: "S", mailRef: "<m@x>", mailClass: "client" });
  return { h, repos, draftId: r.draftId };
};
const base = (draftId: number) => ({ project: "p", draftId, mode: "manual" as const, status: "sending" as const, actor: "cli", to: "c@example.com", subject: "S", body: "full text" });

describe("send_log and Stop all", () => {
  it("record() stores injection_suspected (sticky) and the mail class", async () => {
    const { h, repos, draftId } = await setup();
    await repos.drafts.record({ project: "p", email: "c@example.com", name: "C", subject: "S", mailRef: "<m@x>", mailClass: "client", injectionSuspected: true });
    await repos.drafts.record({ project: "p", email: "c@example.com", name: "C", subject: "S2", mailRef: "<m@x>", mailClass: "client" });
    const d = await repos.drafts.get(draftId);
    expect(d).toMatchObject({ injectionSuspected: true, mailClass: "client", subject: "S2" });
    h.close();
  });

  it("allows one live row per draft; a failed or cancelled one frees it, a sent one does not", async () => {
    const { h, repos, draftId } = await setup();
    const a = await repos.sends.begin(base(draftId));
    await expect(repos.sends.begin(base(draftId))).rejects.toMatchObject({ code: "wrong_state" });
    await repos.sends.markFailed(a.id, "boom");
    const b = await repos.sends.begin(base(draftId));
    await repos.sends.markSent(b.id, "id@x");
    await expect(repos.sends.begin(base(draftId))).rejects.toMatchObject({ code: "wrong_state" });
    expect((await repos.sends.forDraft(draftId)).map((r) => r.status)).toEqual(["sent", "failed"]);
    h.close();
  });

  it("a queued row needs a due time, is claimed once, and only a queued row can be cancelled", async () => {
    const { h, repos, draftId } = await setup();
    await expect(repos.sends.begin({ ...base(draftId), mode: "auto", status: "queued" })).rejects.toThrow(/due time/);
    const q = await repos.sends.begin({ ...base(draftId), mode: "auto", status: "queued", dueAt: "2026-11-20T10:10:00.000Z" });
    expect(await repos.sends.due("2026-11-20T10:09:00.000Z")).toEqual([]);
    expect((await repos.sends.due("2026-11-20T10:10:00.000Z")).map((r) => r.id)).toEqual([q.id]);
    expect(await repos.sends.claim(q.id)).toMatchObject({ status: "sending" });
    expect(await repos.sends.claim(q.id)).toBeNull();
    expect(await repos.sends.cancel(q.id)).toBeNull(); // a sending row cannot be recalled
    h.close();
  });

  it("Stop all: global or per project, cancels the queue, can be lifted", async () => {
    const { h, repos, draftId } = await setup();
    await repos.sends.begin({ ...base(draftId), mode: "auto", status: "queued", dueAt: "2026-11-20T10:10:00.000Z" });
    expect(await repos.sends.isStopped("p")).toBe(false);
    expect(await repos.sends.stop("other")).toBe(0);
    expect(await repos.sends.isStopped("p")).toBe(false);
    expect(await repos.sends.stop()).toBe(1);
    expect(await repos.sends.isStopped("p")).toBe(true);
    expect((await repos.sends.forDraft(draftId))[0]).toMatchObject({ status: "cancelled", error: "Stop all" });
    await repos.sends.resume();
    expect(await repos.sends.isStopped("p")).toBe(false);
    expect(await repos.sends.stoppedScopes()).toEqual(["other"]);
    h.close();
  });
});

describe("Overview counts", () => {
  const rec = (repos: Awaited<ReturnType<typeof setup>>["repos"], n: number, project = "p") =>
    repos.drafts.record({ project, email: `c${n}@example.com`, name: `C${n}`, subject: `S${n}`, mailRef: `<m${n}@x>` });

  it("countsByStatus lists every status, scoped to the project", async () => {
    const { h, repos } = await setup();
    const a = await rec(repos, 2);
    await repos.drafts.setStatus(a.draftId, "skipped", "not interested");
    await rec(repos, 3, "other");
    expect(await repos.drafts.countsByStatus("p")).toEqual({ ready: 1, hold: 0, done: 0, sent: 0, skipped: 1 });
    expect(await repos.drafts.countsByStatus("other")).toEqual({ ready: 1, hold: 0, done: 0, sent: 0, skipped: 0 });
    expect(await repos.drafts.countsByStatus("nobody")).toEqual({ ready: 0, hold: 0, done: 0, sent: 0, skipped: 0 });
    h.close();
  });

  it("injectionHeld counts only ready and hold drafts of the project", async () => {
    const { h, repos, draftId } = await setup();
    expect(await repos.drafts.injectionHeld("p")).toBe(0);
    await repos.drafts.record({ project: "p", email: "c@example.com", name: "C", subject: "S", mailRef: "<m@x>", injectionSuspected: true });
    const b = await repos.drafts.record({ project: "p", email: "c9@example.com", name: "C9", subject: "S9", mailRef: "<m9@x>", injectionSuspected: true });
    const o = await repos.drafts.record({ project: "other", email: "o@example.com", name: "O", subject: "SO", mailRef: "<mo@x>", injectionSuspected: true });
    expect(await repos.drafts.injectionHeld("p")).toBe(2);
    expect(await repos.drafts.injectionHeld("other")).toBe(1);
    await repos.drafts.setStatus(b.draftId, "done");
    await repos.drafts.setStatus(o.draftId, "skipped", "no");
    expect(await repos.drafts.injectionHeld("p")).toBe(1);
    expect(await repos.drafts.injectionHeld("other")).toBe(0);
    expect(draftId).toBeGreaterThan(0);
    h.close();
  });

  it("summarySince counts sent today, failed in the day and stuck sends, per project", async () => {
    const { h, repos, draftId } = await setup();
    const t = (iso: string) => ({ at: iso });
    const sent = await repos.sends.begin({ ...base(draftId), ...t("2026-11-15T09:00:00.000Z") });
    await repos.sends.markSent(sent.id, "id@x");
    const d2 = await rec(repos, 2);
    const failed = await repos.sends.begin({ ...base(d2.draftId), ...t("2026-11-14T20:00:00.000Z") });
    await repos.sends.markFailed(failed.id, "boom");
    const d3 = await rec(repos, 3);
    await repos.sends.begin({ ...base(d3.draftId), ...t("2026-11-15T07:00:00.000Z") }); // still sending
    const d4 = await rec(repos, 4);
    const old = await repos.sends.begin({ ...base(d4.draftId), ...t("2026-11-10T07:00:00.000Z") });
    await repos.sends.markSent(old.id, "old@x");
    const d5 = await rec(repos, 5, "other");
    const foreign = await repos.sends.begin({ ...base(d5.draftId), project: "other", ...t("2026-11-15T08:00:00.000Z") });
    await repos.sends.markSent(foreign.id, "f@x");

    const o = { today: "2026-11-15T00:00:00.000Z", day: "2026-11-14T10:00:00.000Z", stuckBefore: "2026-11-15T09:50:00.000Z" };
    expect(await repos.sends.summarySince("p", o)).toEqual({ sentToday: 1, failed: 1, stuck: 1 });
    expect(await repos.sends.summarySince("other", o)).toEqual({ sentToday: 1, failed: 0, stuck: 0 });
    expect(await repos.sends.summarySince("p", { ...o, stuckBefore: "2026-11-15T06:00:00.000Z" })).toMatchObject({ stuck: 0 });
    h.close();
  });
});
