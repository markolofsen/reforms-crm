import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "../src/client";
import { createRepos, type Repos } from "../src/repos";
import { RepoError } from "../src/errors";
import { seed } from "../src/seed";

// P47: the enrollments repository and the hooks that run inside the drafts, inbox and clients transactions.

let handle: DbHandle;
let repos: Repos;
beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

const P = "p";
const schedule = { delays: [2, 3, 5], businessDays: true };
const NOW = new Date("2026-11-30T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** A client we wrote to `outDays` ago (a sent draft) and who last wrote `inDays` ago. */
async function quiet(email: string, outDays = 10, inDays = 12) {
  const clientId = await repos.clients.create({ project: P, email, name: email.split("@")[0] ?? email, repliesOwed: false, lastContactAt: daysAgo(inDays) });
  await repos.drafts.create({ project: P, clientId, subject: "Re: your enquiry", toAddr: email, body: "b", status: "sent", sentAt: daysAgo(outDays), mailRef: `<${email}>` });
  return clientId;
}
const enrol = (clientId: number) => repos.enrollments.enrol({ project: P, clientId, sequence: "s1", sequenceHash: "h", schedule, by: "owner", now: NOW });
/** What the draft record (`draft_write`) writes for a step drafted by the sequence skill. */
const recordStep = (email: string, enrollmentId: number, step: number, mailRef = `<step-${step}-${email}>`) =>
  repos.drafts.record({ project: P, email, name: email, subject: "Re: your enquiry", mailRef, skill: "sequence-drafts", repliesOwed: false, sequence: { enrollmentId, step } });

describe("enrol", () => {
  it("anchors on our newest sent message, step 1, due after the first wait; one open enrollment per client", async () => {
    const c = await quiet("a@x.example");
    const e = await enrol(c);
    expect(e).toMatchObject({ state: "active", step: 1, anchorAt: daysAgo(10), enrolledBy: "owner", sequence: "s1" });
    expect(Date.parse(e.nextDueAt ?? "")).toBeGreaterThan(Date.parse(daysAgo(10)));
    await expect(enrol(c)).rejects.toThrow(RepoError);
    await expect(enrol(c)).rejects.toThrow("already has follow-ups running");
  });
  it("refuses a client with nothing sent, a do-not-contact mark, an open draft, or of another project", async () => {
    const none = await repos.clients.create({ project: P, email: "n@x.example", name: "n", repliesOwed: false });
    await expect(enrol(none)).rejects.toThrow("nothing to follow up");
    const dnc = await quiet("d@x.example");
    await repos.clients.setMarks(dnc, ["do_not_contact"]);
    await expect(enrol(dnc)).rejects.toThrow("do not contact");
    const open = await quiet("o@x.example");
    await repos.drafts.create({ project: P, clientId: open, subject: "Re: x", toAddr: "o@x.example", body: "b", status: "ready" });
    await expect(enrol(open)).rejects.toThrow("open draft");
    const other = await quiet("q@x.example");
    await expect(repos.enrollments.enrol({ project: "other", clientId: other, sequence: "s1", sequenceHash: "h", schedule, by: "owner" })).rejects.toThrow("No such client");
  });
});

describe("due and candidates", () => {
  it("due: active, the date has come, no open draft; a recorded step draft takes it off the due list", async () => {
    const e = await enrol(await quiet("a@x.example"));
    expect((await repos.enrollments.list(P, "due", NOW)).map((x) => x.id)).toEqual([e.id]);
    expect((await repos.enrollments.list(P, "due", new Date(daysAgo(9.5)))).length).toBe(0);
    const r = await recordStep("a@x.example", e.id, 1);
    expect(r.action).toBe("created");
    expect(await repos.enrollments.list(P, "due", NOW)).toEqual([]);
    expect((await repos.enrollments.list(P, "active", NOW))[0]).toMatchObject({ display: "draft_ready", openDraftId: r.draftId, steps: 3 });
    expect(await repos.enrollments.counts(P, NOW)).toEqual({ due: 0, active: 1 });
  });
  it("candidates: our message newer than theirs and old enough, no mark, no open draft, not covered; Not now covers this silence", async () => {
    const a = await quiet("a@x.example", 10, 12);
    await quiet("recent@x.example", 0.5, 12); // ours too recent
    await quiet("theirs@x.example", 10, 5); // they wrote after us
    const enrolled = await quiet("e@x.example");
    await enrol(enrolled);
    const list = await repos.enrollments.candidates(P, { now: NOW, afterDays: 2, businessDays: true });
    expect(list.map((c) => c.client.email)).toEqual(["a@x.example"]);
    expect(list[0]?.last).toMatchObject({ at: daysAgo(10), mailRef: "<a@x.example>" });
    await repos.enrollments.notNow({ project: P, clientId: a, sequence: "s1", sequenceHash: "h", schedule, by: "owner", now: NOW });
    expect(await repos.enrollments.candidates(P, { now: NOW, afterDays: 2, businessDays: true })).toEqual([]);
    // We write again: the client may be offered again.
    await repos.drafts.create({ project: P, clientId: a, subject: "Re: x", toAddr: "a@x.example", body: "b", status: "sent", sentAt: daysAgo(4) });
    expect((await repos.enrollments.candidates(P, { now: NOW, afterDays: 2, businessDays: true })).map((c) => c.client.email)).toEqual(["a@x.example"]);
  });
});

describe("the step draft moves the enrollment", () => {
  it.each(["done", "skipped"] as const)("%s by the owner advances to the next step, anchored on that moment", async (status) => {
    const e = await enrol(await quiet("a@x.example"));
    const r = await recordStep("a@x.example", e.id, 1);
    await repos.drafts.setStatus(r.draftId, status);
    expect(await repos.enrollments.get(P, e.id, NOW)).toMatchObject({ state: "active", step: 2 });
  });
  it("sent (the Sent folder) advances at the sent date; a later sent of a draft already done is not a second step", async () => {
    const e = await enrol(await quiet("a@x.example"));
    const r = await recordStep("a@x.example", e.id, 1);
    await repos.drafts.markSent(r.draftId, { at: daysAgo(1), via: "message-id", messageId: "<m1>" });
    expect(await repos.enrollments.get(P, e.id, NOW)).toMatchObject({ step: 2, anchorAt: daysAgo(1) });
    const r2 = await recordStep("a@x.example", e.id, 2);
    await repos.drafts.setStatus(r2.draftId, "done");
    await repos.drafts.markSent(r2.draftId, { at: daysAgo(0), via: "message-id", messageId: "<m2>" });
    expect((await repos.enrollments.get(P, e.id, NOW))?.step).toBe(3);
  });
  it("after the last step the enrollment is completed; Undo of that Done reopens it", async () => {
    const e = await enrol(await quiet("a@x.example"));
    for (const step of [1, 2, 3]) {
      const r = await recordStep("a@x.example", e.id, step);
      await repos.drafts.setStatus(r.draftId, "done");
      if (step === 3) {
        expect(await repos.enrollments.get(P, e.id, NOW)).toMatchObject({ state: "finished", finishReason: "completed" });
        await repos.drafts.undo(r.draftId);
        expect(await repos.enrollments.get(P, e.id, NOW)).toMatchObject({ state: "active", step: 3 });
      }
    }
  });
  it("refuses a step that is not the open one, and a step over another open draft", async () => {
    const e = await enrol(await quiet("a@x.example"));
    await expect(recordStep("a@x.example", e.id, 2)).rejects.toThrow("not the open step");
    const f = await enrol(await quiet("b@x.example"));
    await repos.drafts.record({ project: P, email: "b@x.example", name: "b", subject: "s", mailRef: "<b-own>", skill: "sequence-drafts" });
    await expect(recordStep("b@x.example", f.id, 1)).rejects.toThrow("open draft");
  });
});

describe("a reply finishes the follow-ups in the record's own transaction", () => {
  it("a triage draft record: finished as replied, the open step draft skipped, the reply drafted", async () => {
    const e = await enrol(await quiet("a@x.example"));
    const step = await recordStep("a@x.example", e.id, 1);
    const reply = await repos.drafts.record({ project: P, email: "a@x.example", name: "a", subject: "Re: thanks", mailRef: "<their-reply>", skill: "triage-mail", lastContactAt: NOW.toISOString() });
    expect(reply).toMatchObject({ action: "created", followUps: "replied" });
    expect(await repos.enrollments.get(P, e.id, NOW)).toMatchObject({ state: "finished", finishReason: "replied" });
    expect(await repos.drafts.get(step.draftId)).toMatchObject({ status: "skipped", skipReason: "Client replied" });
  });
  it("a triage client_record does the same; a crossed-off client is excluded; an inbound before our anchor is no reply", async () => {
    const a = await enrol(await quiet("a@x.example"));
    const b = await enrol(await quiet("b@x.example"));
    const c = await enrol(await quiet("c@x.example"));
    expect(await repos.inbox.record({ project: P, email: "a@x.example", name: "a", action: "escalated", skill: "triage-mail", lastInboundAt: NOW.toISOString() })).toMatchObject({ followUps: "replied" });
    await repos.inbox.record({ project: P, email: "b@x.example", name: "b", action: "skipped", kind: "crossed_off", skill: "triage-mail" });
    await repos.inbox.record({ project: P, email: "c@x.example", name: "c", action: "skipped", skill: "triage-mail", lastInboundAt: daysAgo(20) });
    expect((await repos.enrollments.get(P, a.id))?.finishReason).toBe("replied");
    expect((await repos.enrollments.get(P, b.id))?.finishReason).toBe("excluded");
    expect((await repos.enrollments.get(P, c.id))?.state).toBe("active");
  });
  it("P85: a message on the owner's words (ownerRequest) is not a reply: the follow-ups stay active", async () => {
    const e = await enrol(await quiet("a@x.example"));
    const r = await repos.drafts.record({ project: P, email: "a@x.example", name: "a", subject: "Re: thanks", mailRef: "<our-last>", skill: "bulk-drafts", ownerRequest: "write to him about the new prices" });
    expect(r.followUps).toBeUndefined();
    expect((await repos.enrollments.get(P, e.id))?.state).toBe("active");
  });
  it("P85: an open follow-up step is never pushed aside by a message on the owner's words", async () => {
    const e = await enrol(await quiet("b@x.example"));
    const step = await recordStep("b@x.example", e.id, 1);
    await expect(repos.drafts.record({ project: P, email: "b@x.example", name: "b", subject: "Re: thanks", mailRef: "<our-last-b>", skill: "bulk-drafts", ownerRequest: "write to him again" })).rejects.toThrow(/open draft .*follow-up step/);
    expect((await repos.drafts.get(step.draftId))?.status).toBe("ready");
    expect((await repos.enrollments.get(P, e.id))?.state).toBe("active");
  });
  it("the sequence skill's own records are not a reply; Do not contact finishes as opted out", async () => {
    const e = await enrol(await quiet("a@x.example"));
    await repos.inbox.record({ project: P, email: "a@x.example", name: "a", action: "skipped", skill: "sequence-drafts" });
    expect((await repos.enrollments.get(P, e.id))?.state).toBe("active");
    const step = await recordStep("a@x.example", e.id, 1);
    await repos.clients.setMarks(e.clientId, ["do_not_contact"]);
    expect(await repos.enrollments.get(P, e.id)).toMatchObject({ state: "finished", finishReason: "opted_out" });
    expect((await repos.drafts.get(step.draftId))?.status).toBe("skipped");
  });
});

describe("the owner's moves", () => {
  it("stop skips the open step draft; pause and resume; a finished one refuses with wrong_state", async () => {
    const e = await enrol(await quiet("a@x.example"));
    await repos.enrollments.pause(P, e.id);
    await expect(repos.enrollments.pause(P, e.id)).rejects.toThrow("already paused");
    await repos.enrollments.resume(P, e.id);
    const step = await recordStep("a@x.example", e.id, 1);
    expect(await repos.enrollments.stop(P, e.id, "stopped")).toMatchObject({ state: "finished", finishReason: "stopped" });
    expect(await repos.drafts.get(step.draftId)).toMatchObject({ status: "skipped", skipReason: "Follow-ups stopped" });
    await expect(repos.enrollments.resume(P, e.id)).rejects.toMatchObject({ code: "wrong_state" });
    await expect(repos.enrollments.stop("other", e.id)).rejects.toMatchObject({ code: "not_found" });
  });
  it("delay moves the next step after the return date and keeps it active", async () => {
    const e = await enrol(await quiet("a@x.example"));
    const d = await repos.enrollments.delay(P, e.id, "2026-12-11T00:00:00.000Z");
    expect(d.state).toBe("active");
    expect(Date.parse(d.nextDueAt ?? "")).toBeGreaterThan(Date.parse("2026-12-11T00:00:00.000Z"));
  });
});

describe("the seed", () => {
  it("has one due enrollment and one candidate in lisbon-realty", async () => {
    await seed(repos);
    expect((await repos.enrollments.list("lisbon-realty", "due")).map((e) => e.client.email)).toEqual(["tiago@example.com"]);
    expect((await repos.enrollments.candidates("lisbon-realty", { afterDays: 2, businessDays: true })).map((c) => c.client.email)).toEqual(["ines@example.org"]);
  });
});
