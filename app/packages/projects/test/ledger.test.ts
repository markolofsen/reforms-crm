import { describe, expect, it } from "vitest";
import { auditEvidence, entryFor, preDraftCheck, replayCalls, summarizeCall, type CallRecord, type ClaimedRecord, type LedgerEntry } from "../src/index";

const M = "mcp__mail-mcp__";
const t = (s: unknown) => [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s) }];
const find = (sender: string, ids: number[]): CallRecord => ({ name: `${M}find_messages`, input: { account: "a", mailboxPath: ["INBOX"], sender }, result: t(ids.map((id) => ({ id, sender }))) });
const read = (id: number, from: string): CallRecord => ({ name: `${M}get_message_content`, input: { account: "a", mailboxPath: ["INBOX"], message_id: id }, result: t({ id, from: `X <${from}>`, date: "2026-11-01", body: "..." }) });
const notion = (email: string): CallRecord => ({ name: "mcp__notion__notion-query-data-sources", input: { query: `Email = ${email}` }, result: t("[]") });
const kb: CallRecord = { name: "mcp__knowledge-mcp__knowledge_search", input: { project: "p", query: "x" }, result: t("[]") };
const reply = (id: number, content: string): CallRecord => ({ name: `${M}create_reply`, input: { account: "a", mailbox_path: ["INBOX"], message_id: id, content }, result: t("ok") });

const build = (calls: CallRecord[]): LedgerEntry[] => { const e: LedgerEntry[] = []; replayCalls(calls, e, []); return e; };

describe("ledger entries", () => {
  it("keep ids, sender and a sketch, never a body", () => {
    const e = summarizeCall(reply(5, "Hello there, this is the secret body text."))!;
    expect(e).toMatchObject({ kind: "draft", replyTo: 5 });
    expect(JSON.stringify(e)).not.toContain("secret");
    expect(summarizeCall(read(5, "A@X.example"))).toMatchObject({ kind: "read", id: 5, from: "a@x.example" });
    expect(summarizeCall(find("a@x.example", []))).toMatchObject({ kind: "find", ids: [] });
  });
  it("an unreadable find result is unknown, not zero", () => {
    expect(summarizeCall({ name: `${M}find_messages`, input: { account: "a", mailboxPath: ["INBOX"], sender: "s" }, result: t("weird output") })?.ids).toBeNull();
  });
});

describe("pre-draft check (B3)", () => {
  const careful = (id: number, who: string): CallRecord[] => [notion(who), find(who, [id, id - 1, id - 2, id - 3]), read(id, who), read(id - 1, who), read(id - 2, who), kb];

  it("12 create_reply with 1 read is a violation for every reply", () => {
    const calls: CallRecord[] = [find("c0@x.example", [1, 2, 3]), read(1, "c0@x.example")];
    const entries: LedgerEntry[] = [];
    let bad = 0;
    for (let i = 0; i < 12; i++) {
      const c = reply(100 + i, `Reply number ${i} with its own words about topic ${i} and place ${i * 7}.`);
      if (i === 0) c.input = { ...(c.input as object), message_id: 1 };
      const r = preDraftCheck(entries.length ? entries : build(calls), c);
      if (r.violations.length) bad++;
      replayCalls([c], entries, []);
      if (!entries.length) replayCalls(calls, entries, []);
    }
    expect(bad).toBeGreaterThanOrEqual(11);
  });

  it("the careful sequence passes", () => {
    const e = build(careful(10, "a@x.example"));
    const r = preDraftCheck(e, reply(10, "Your lot 14 certificate arrived; the Harbour Road plan matches."));
    expect(r.violations).toEqual([]);
    expect(r.observation).toMatchObject({ client: "a@x.example", read: 3, required: 3, profile: true, facts: 1 });
  });

  it("a first-contact sequence passes: empty search, the message itself read, profile, facts", () => {
    const e = build([notion("n@x.example"), find("n@x.example", []), read(50, "n@x.example"), kb]);
    expect(preDraftCheck(e, reply(50, "Welcome. About the vineyard plot you describe: here is what we do next.")).violations).toEqual([]);
  });

  it("names exactly what is missing", () => {
    const e = build([read(10, "a@x.example")]);
    const v = preDraftCheck(e, reply(10, "Some reply here.")).violations[0]!;
    expect(v).toContain("(b)");
    expect(v).toContain("(d)");
    expect(v).not.toContain("(a)");
  });

  it("a near-copy of an earlier reply in the session is caught live, before it is created", () => {
    const body = (n: string) => `Hi ${n},\n\nThank you for your message and for your patience. We have received your question and our team is reviewing the details of your property now. We will come back to you in the next few days with the information you need, and please contact us if anything changes in the meantime.\n\nKind regards, the desk`;
    const e = build([...careful(10, "a@x.example"), reply(10, body("Anna")), ...careful(20, "b@x.example")]);
    const r = preDraftCheck(e, reply(20, body("Boris")));
    expect(r.violations.join(" ")).toContain("near-copy");
    expect(r.observation!.similarTo).not.toBeNull();
  });

  it("reads are kept per subagent: another agent's reads do not count", () => {
    const e = build(careful(10, "a@x.example")).map((x) => ({ ...x, aid: "A1" }));
    expect(preDraftCheck(e, reply(10, "A reply from a subagent that read nothing."), { aid: "A2" }).violations.join()).toContain("missing");
    expect(preDraftCheck(e, reply(10, "A reply from the subagent that read it all, with its own words."), { aid: "A1" }).violations).toEqual([]);
  });

  it("not a reply: not judged", () => expect(preDraftCheck([], find("a", [1])).violations).toEqual([]));
});

describe("audit evidence (B4)", () => {
  it("rows carry read, profile, facts, anchors and a verdict; a claim above the observation is red", () => {
    const claim: ClaimedRecord = { email: "a@x.example", context: { thread: { read: 3 }, anchors: ["x"] } };
    const entries = build([notion("a@x.example"), find("a@x.example", [1, 2, 3, 4]), read(1, "a@x.example"), kb, reply(1, "A reply.")]);
    const rows = auditEvidence(entries, [{ after: entries.length, claim }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client: "a@x.example", read: "1/3", profile: "read", facts: 1, anchors: "1", verdict: "red" });
    expect(rows[0]!.notes.join()).toContain("claims 3 read, observed 1");
  });
  it("entryFor takes the client's own name out of the sketch", () => {
    const e = build([read(1, "anna@x.example")]);
    const a = entryFor(e, reply(1, "Thanks, anna, the lot 14 plan is here. Anna, see it."))!;
    const b = entryFor(e, reply(1, "Thanks, , the lot 14 plan is here. , see it."))!;
    expect(a.fp).toEqual(b.fp);
  });
});


describe("read summary from a JSON reply", () => {
  it("takes the sender from the message, not from a DKIM h= list in the raw headers", () => {
    const result = JSON.stringify({ message: { id: 1, sender: "Ann <ann@x.com>", dateReceived: "2026-11-16", allHeaders: "dkim-signature: h=to:from:subject; from: header.i=@evil.com" } });
    expect(summarizeCall({ name: "mcp__mail-mcp__get_message_content", input: { message_id: 1 }, result })).toMatchObject({ from: "ann@x.com", date: "2026-11-16" });
  });
});
