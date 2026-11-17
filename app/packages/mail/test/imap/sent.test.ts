import { describe, expect, it } from "vitest";
import { buildEml } from "../../src/imap/fake";
import { findSentMailbox, matchSent, normSubject, readSent, type DraftToMatch, type SentMessage } from "../../src/imap/sent";
import { account, ANNA, ME, server } from "./helpers";

const sent = (o: Partial<SentMessage> & { messageId: string; date: string }): SentMessage => ({
  inReplyTo: null, references: [], to: [ANNA], cc: [], subject: "Offer", account: "Google", mailbox: "Sent", ...o,
});
const draft = (o: Partial<DraftToMatch> & { id: number }): DraftToMatch => ({
  subject: "Offer", to: ANNA, mailRef: null, createdAt: "2026-11-03T08:00:00.000Z", ...o,
});

describe("normSubject", () => {
  it("drops reply and forward prefixes in several languages, spacing and case", () => {
    expect(normSubject("RE: Re[2]: AW:  Offer   for you")).toBe("offer for you");
    expect(normSubject("Fwd: Ответ: Offer")).toBe("offer");
    expect(normSubject("  Offer ")).toBe("offer");
    expect(normSubject("Reasonable offer")).toBe("reasonable offer");
  });
});

describe("readSent", () => {
  it("finds the Sent folder by special-use, by name, or by the configured name, and reads since a date", async () => {
    const s = server();
    const session = await s.connect(account());
    expect(await findSentMailbox(account(), session)).toBe("Sent");
    expect(await findSentMailbox(account({ sentMailbox: "Sent" }), session)).toBe("Sent");
    await expect(findSentMailbox(account({ sentMailbox: "Nope" }), session)).rejects.toMatchObject({ code: "unavailable" });
    const got = await readSent(account(), session, new Date("2026-11-03T00:00:00Z"));
    expect(got.map((m) => m.messageId)).toEqual(["<s2@x>"]);
    expect(got[0]).toMatchObject({ to: [ANNA], subject: "Offer", account: "Google", mailbox: "Sent" });
    const all = await readSent(account(), session, new Date("2026-01-01T00:00:00Z"));
    expect(all.map((m) => m.messageId)).toEqual(["<s1@x>", "<s2@x>"]);
    expect(all[0]!.inReplyTo).toBe("<a1@x>");
    expect(all[0]!.references).toEqual(["<a1@x>"]);
  });

  it("reports an account with no Sent folder", async () => {
    const s = server();
    delete s.boxes.Google!.Sent;
    await expect(readSent(account(), await s.connect(account()), new Date(0))).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("matchSent", () => {
  it("matches by the draft's own Message-Id first, whatever the subject", () => {
    const m = matchSent([draft({ id: 1, mailRef: "<own@x>", subject: "Something" })], [sent({ messageId: "<own@x>", date: "2026-11-04T09:00:00Z", subject: "Changed by the person", to: ["x@y.test"] })]);
    expect(m).toMatchObject([{ draftId: 1, via: "message-id" }]);
  });

  it("matches a reply in the thread the draft answers when it goes to the draft's recipient", () => {
    const ok = sent({ messageId: "<r@x>", date: "2026-11-04T09:00:00Z", subject: "Totally different", inReplyTo: "<thread@x>" });
    expect(matchSent([draft({ id: 1, mailRef: "<thread@x>" })], [ok])).toMatchObject([{ draftId: 1, via: "thread" }]);
    // same thread, another recipient: not this draft
    expect(matchSent([draft({ id: 1, mailRef: "<thread@x>" })], [{ ...ok, to: ["other@y.test"] }])).toEqual([]);
    // sent before the draft existed
    expect(matchSent([draft({ id: 1, mailRef: "<thread@x>", createdAt: "2026-11-05T00:00:00Z" })], [ok])).toEqual([]);
  });

  it("matches by subject and recipient (Re: ignored, To or Cc, display name in the draft), after the draft was made", () => {
    const base = sent({ messageId: "<s@x>", date: "2026-11-04T09:00:00Z", subject: "Re: OFFER" });
    expect(matchSent([draft({ id: 1, to: `Anna Fake <${ANNA}>, bob@example.test` })], [base])).toMatchObject([{ draftId: 1, via: "subject-recipient" }]);
    expect(matchSent([draft({ id: 1 })], [{ ...base, to: ["z@y.test"], cc: [ANNA] }])).toHaveLength(1);
    expect(matchSent([draft({ id: 1 })], [{ ...base, subject: "Other topic" }])).toEqual([]);
    expect(matchSent([draft({ id: 1 })], [{ ...base, to: ["z@y.test"] }])).toEqual([]);
    expect(matchSent([draft({ id: 1, createdAt: "2026-11-05T00:00:00Z" })], [base])).toEqual([]);
    expect(matchSent([draft({ id: 1, subject: "" })], [{ ...base, subject: "" }])).toEqual([]);
  });

  it("one sent message satisfies one draft, the oldest first; the next send satisfies the next", () => {
    const d1 = draft({ id: 1, createdAt: "2026-11-01T00:00:00Z" });
    const d2 = draft({ id: 2, createdAt: "2026-11-02T00:00:00Z" });
    const s1 = sent({ messageId: "<s1@x>", date: "2026-11-04T09:00:00Z" });
    const s2 = sent({ messageId: "<s2@x>", date: "2026-11-06T09:00:00Z" });
    expect(matchSent([d2, d1], [s1]).map((m) => m.draftId)).toEqual([1]);
    expect(matchSent([d2, d1], [s2, s1]).map((m) => [m.draftId, m.sent.messageId])).toEqual([[1, "<s1@x>"], [2, "<s2@x>"]]);
  });

  it("a stronger match wins the message over a weaker one", () => {
    const s = sent({ messageId: "<own@x>", date: "2026-11-04T09:00:00Z" });
    const m = matchSent([draft({ id: 1, createdAt: "2026-11-01T00:00:00Z" }), draft({ id: 2, mailRef: "<own@x>", createdAt: "2026-11-02T00:00:00Z" })], [s]);
    expect(m).toMatchObject([{ draftId: 2, via: "message-id" }]);
  });

  it("matches nothing when nothing was sent", () => {
    expect(matchSent([draft({ id: 1 })], [])).toEqual([]);
    expect(matchSent([], [sent({ messageId: "<s@x>", date: "2026-11-04T09:00:00Z" })])).toEqual([]);
  });
});

describe("end to end on the fake server", () => {
  it("a message the person sends later is found by the next read", async () => {
    const s = server();
    const session = await s.connect(account());
    const before = await readSent(account(), session, new Date("2026-11-08T00:00:00Z"));
    expect(matchSent([draft({ id: 1, subject: "Bulk hello", createdAt: "2026-11-08T08:00:00Z" })], before)).toEqual([]);
    s.add("Google", "Sent", buildEml({ from: ME, to: ANNA, subject: "Bulk hello", messageId: "<new@x>", date: "2026-11-08T10:00:00Z" }));
    const after = await readSent(account(), session, new Date("2026-11-08T00:00:00Z"));
    expect(matchSent([draft({ id: 1, subject: "Bulk hello", createdAt: "2026-11-08T08:00:00Z" })], after)).toMatchObject([{ draftId: 1, via: "subject-recipient" }]);
  });
});
