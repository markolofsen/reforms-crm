import { describe, expect, it } from "vitest";
import { createRepos } from "../src/repos";
import { openDb } from "../src/client";

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
    // P112 S2: the row's own write reads Stop again, so no send starts while it is on, whatever the caller checked before.
    await expect(repos.sends.begin(base(draftId))).rejects.toMatchObject({ code: "wrong_state", message: "Stop all is on" });
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

describe("messenger sends in send_log (P71 M4)", () => {
  const limits = { dailyCap: 3, spacingSeconds: 20 };
  const at = (s: number) => new Date(Date.UTC(2026, 10, 20, 12, 0, s)).toISOString();
  const msetup = async () => {
    const h = openDb(":memory:");
    const repos = createRepos(h.db);
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push((await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId: "1001", text: `t${i}`, createdBy: "agent" })).id);
    const one = (i: number, s: number) => ({ project: "p", channel: "telegram_user" as const, messengerDraftId: ids[i]!, account: "42", to: "telegram:1001", name: "Anna", text: `t${i}`, actor: "admin", at: at(s), limits });
    return { h, repos, ids, one };
  };

  it("writes the row first with its channel, refuses a second live row of one draft, and frees it after a failure", async () => {
    const { h, repos, one } = await msetup();
    const a = await repos.sends.beginMessage(one(0, 0));
    expect(a).toMatchObject({ channel: "telegram_user", messengerDraftId: one(0, 0).messengerDraftId, draftId: null, status: "sending", sender: "42", toAddr: "telegram:1001", subject: "Anna", body: "t0", mode: "manual" });
    await expect(repos.sends.beginMessage(one(0, 60))).rejects.toThrow(/already being sent/);
    await repos.sends.markFailed(a.id, "network");
    await expect(repos.sends.beginMessage(one(0, 60))).resolves.toMatchObject({ status: "sending" });
    h.close();
  });

  it("refuses inside the spacing (a failed attempt counts) and over the 24 h cap, in words", async () => {
    const { h, repos, one } = await msetup();
    const a = await repos.sends.beginMessage(one(0, 0));
    await repos.sends.markFailed(a.id, "network");
    await expect(repos.sends.beginMessage(one(1, 10))).rejects.toThrow(/under 20 seconds ago: wait 10 s/);
    await repos.sends.markSent((await repos.sends.beginMessage(one(1, 20))).id, "1");
    await repos.sends.markSent((await repos.sends.beginMessage(one(2, 40))).id, "2");
    await repos.sends.beginMessage(one(3, 60));
    await expect(repos.sends.beginMessage(one(4, 90))).rejects.toThrow(/sent 3 messages in the last 24 hours, the cap is 3/);
    expect(await repos.sends.messengerUsage("telegram_user", "42", at(90))).toEqual({ sentLastDay: 3, lastAttemptAt: at(60) });
    // Another account is counted apart; a mail row never counts.
    await expect(repos.sends.beginMessage({ ...one(4, 90), account: "43" })).resolves.toMatchObject({ sender: "43" });
    h.close();
  });

  it("refuses while Stop sending is on, for this project or every project", async () => {
    const { h, repos, one } = await msetup();
    await repos.sends.stop();
    await expect(repos.sends.beginMessage(one(0, 0))).rejects.toThrow(/Stop sending is on/);
    await repos.sends.resume();
    await repos.sends.stop("p");
    await expect(repos.sends.beginMessage(one(0, 0))).rejects.toThrow(/Stop sending is on/);
    expect(await repos.sends.list("p")).toEqual([]);
    h.close();
  });
});
