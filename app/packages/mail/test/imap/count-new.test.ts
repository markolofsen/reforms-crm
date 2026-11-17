import { describe, expect, it } from "vitest";
import { buildEml, FakeImapServer } from "../../src/imap/fake";
import { countNewSince, NEW_WINDOW_DAYS, windowStart } from "../../src/imap/count-new";
import { account, ANNA, ME } from "./helpers";

const BOB = "bob@example.test";
const NEWS = "news@example.test";
const SINCE = new Date("2026-11-03T00:00:00Z");

const inbound = (o: { from?: string; subject: string; id: string; date: string; inReplyTo?: string; references?: string[] }) =>
  buildEml({ from: o.from ?? ANNA, to: ME, subject: o.subject, messageId: o.id, date: o.date, ...(o.inReplyTo ? { inReplyTo: o.inReplyTo } : {}), ...(o.references ? { references: o.references } : {}) });
const outbound = (o: { to?: string; subject: string; id: string; date: string; inReplyTo?: string; references?: string[] }) =>
  buildEml({ from: ME, to: o.to ?? ANNA, subject: o.subject, messageId: o.id, date: o.date, ...(o.inReplyTo ? { inReplyTo: o.inReplyTo } : {}), ...(o.references ? { references: o.references } : {}) });

function server(inbox: string[], sent: string[] = [], extra: Record<string, { specialUse?: string; messages: string[] }> = {}) {
  return new FakeImapServer({ Google: { INBOX: { messages: inbox }, Sent: { specialUse: "\\Sent", messages: sent }, Drafts: { specialUse: "\\Drafts", messages: [inbound({ subject: "A draft", id: "<dr@x>", date: "2026-11-09T09:00:00Z" })] }, ...extra } });
}
const run = async (s: FakeImapServer, over: Partial<Parameters<typeof countNewSince>[2]> = {}, acc = account()) => countNewSince(acc, await s.connect(acc), { since: SINCE, ...over });

describe("windowStart", () => {
  it("is the later of the last triage and the 14-day floor", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    expect(NEW_WINDOW_DAYS).toBe(14);
    expect(windowStart(now).toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(windowStart(now, new Date("2026-10-01T00:00:00Z")).toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(windowStart(now, new Date("2026-11-14T08:00:00Z")).toISOString()).toBe("2026-11-14T08:00:00.000Z");
    expect(windowStart(now, null).toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });
});

describe("countNewSince", () => {
  it("counts inbound mail since the date, not older mail, not drafts", async () => {
    const s = server([
      inbound({ subject: "Old", id: "<o1@x>", date: "2026-11-01T09:00:00Z" }),
      inbound({ subject: "New one", id: "<n1@x>", date: "2026-11-05T09:00:00Z" }),
      inbound({ from: BOB, subject: "New two", id: "<n2@x>", date: "2026-11-06T09:00:00Z" }),
    ]);
    expect(await run(s)).toMatchObject({ count: 2, scanned: 2, answersChecked: true });
  });

  it("does not count a thread that has a later outbound message (In-Reply-To, References)", async () => {
    const s = server(
      [
        inbound({ subject: "Viewing", id: "<v1@x>", date: "2026-11-05T09:00:00Z" }),
        inbound({ from: BOB, subject: "Offer", id: "<f1@x>", date: "2026-11-05T10:00:00Z" }),
        inbound({ from: BOB, subject: "Other topic", id: "<f2@x>", date: "2026-11-05T11:00:00Z" }),
      ],
      [
        outbound({ subject: "Re: Viewing", id: "<s1@x>", date: "2026-11-05T12:00:00Z", inReplyTo: "<v1@x>" }),
        outbound({ to: BOB, subject: "Different subject entirely", id: "<s2@x>", date: "2026-11-05T12:00:00Z", references: ["<f1@x>"] }),
      ],
    );
    expect((await run(s)).count).toBe(1);
  });

  it("matches by normalised subject and recipient when the answer carries no reference", async () => {
    const s = server([inbound({ subject: "Keys", id: "<k1@x>", date: "2026-11-05T09:00:00Z" }), inbound({ from: BOB, subject: "Keys", id: "<k2@x>", date: "2026-11-05T09:30:00Z" })], [outbound({ subject: "Re: Keys", id: "<ks@x>", date: "2026-11-05T10:00:00Z" })]);
    // The answer went to Anna only: Bob's mail with the same subject is still waiting.
    expect((await run(s)).count).toBe(1);
  });

  it("an answer sent BEFORE the message does not answer it", async () => {
    const s = server([inbound({ subject: "Keys", id: "<k1@x>", date: "2026-11-06T09:00:00Z" })], [outbound({ subject: "Re: Keys", id: "<ks@x>", date: "2026-11-05T10:00:00Z" })]);
    expect((await run(s)).count).toBe(1);
  });

  it("never counts the account's own mail, nor an extra own address", async () => {
    const s = server([inbound({ from: ME, subject: "Note to self", id: "<me@x>", date: "2026-11-05T09:00:00Z" }), inbound({ from: "alias@example.test", subject: "From my alias", id: "<al@x>", date: "2026-11-05T09:00:00Z" })]);
    expect((await run(s)).count).toBe(1);
    expect((await run(s, { me: ["alias@example.test"] })).count).toBe(0);
  });

  it("leaves out senders the project's filter rules call non-clients", async () => {
    const s = server([inbound({ from: NEWS, subject: "Weekly digest", id: "<d1@x>", date: "2026-11-05T09:00:00Z" }), inbound({ subject: "Question", id: "<q1@x>", date: "2026-11-05T09:00:00Z" })]);
    const seen: { from: string; subject: string }[] = [];
    const r = await run(s, { excluded: (m) => (seen.push(m), m.from === NEWS) });
    expect(r.count).toBe(1);
    expect(seen.map((m) => m.from).sort()).toEqual([ANNA, NEWS]);
  });

  it("counts one message once when two mailboxes hold it (Gmail labels)", async () => {
    const mail = inbound({ subject: "Twice", id: "<tw@x>", date: "2026-11-05T09:00:00Z" });
    const s = server([mail], [], { Label: { messages: [mail] } });
    expect(await run(s)).toMatchObject({ count: 1, scanned: 1 });
  });

  it("reads the Sent folder even when the account is limited to INBOX", async () => {
    const s = server([inbound({ subject: "Viewing", id: "<v1@x>", date: "2026-11-05T09:00:00Z" })], [outbound({ subject: "Re: Viewing", id: "<s1@x>", date: "2026-11-05T12:00:00Z", inReplyTo: "<v1@x>" })]);
    expect((await run(s, {}, account({ mailboxes: ["INBOX"] }))).count).toBe(0);
  });

  it("is an upper bound and says so when no Sent folder can be read", async () => {
    const s = new FakeImapServer({ Google: { INBOX: { messages: [inbound({ subject: "Viewing", id: "<v1@x>", date: "2026-11-05T09:00:00Z" })] } } });
    expect(await run(s)).toMatchObject({ count: 1, answersChecked: false });
  });

  it("reads headers only: no call fetches a source", async () => {
    const s = server([inbound({ subject: "Viewing", id: "<v1@x>", date: "2026-11-05T09:00:00Z" })]);
    await run(s);
    expect(s.ops.length).toBeGreaterThan(0);
    expect(s.ops.filter((o) => /:source:/.test(o))).toEqual([]);
    expect(s.ops.map((o) => o.split(":")[1]).every((m) => ["list", "search", "headers", "close"].includes(m ?? ""))).toBe(true);
    // Drafts are never read.
    expect(s.ops.filter((o) => o.endsWith(":Drafts"))).toEqual([]);
  });
});
