import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb } from "@hub/db";
import { replayCalls, type LedgerEntry } from "@hub/projects";
import { appendLine, readLines, recordsFile, sessionFile } from "@hub/projects/evidence-store";
import type { RecordLine } from "../src/records/checks";
import { recordDraftCall } from "../src/records/draft";
import { draftRecord } from "../src/records/schema";
import { okOf, recordCall, recordsInstance } from "./records-fixture";

// The evidence block of a draft record (P28 B1, B5; P52): what `draft_write`'s record carries in `record.context`, judged
// by the writer before anything is written, cross-checked with the session's ledger, and kept by a revision.

let db: string;
let root: string;
let projects: string;
let policy: string;
beforeEach(() => {
  ({ db, root, projects, policy } = recordsInstance());
});

const ctx = (over: Record<string, unknown> = {}) => ({
  batchKey: "bulk-1",
  thread: { firstContact: false, found: 4, read: 3, readIds: [1, 2, 3], cited: [1], newest: "2026-11-10" },
  profile: { read: true, state: "filled" },
  facts: { queries: 1, used: [], missing: [] },
  anchors: ["asked for the certificate of title"],
  personalization: "Refers to the certificate of title he asked about on 10 Jul and the next step.",
  ...over,
});
interface Rec { email: string; mailRef: string; subject?: string; record: Record<string, unknown> }
/** A reply to `<email>` carrying this context block, as draft_write records it. */
const reply = (email: string, c: unknown, extra: Record<string, unknown> = {}): Rec => ({ email, mailRef: `<${email}>`, record: { name: email, context: c, ...extra } });
const run = (p: Rec, o: { required?: "warn" | "block"; now?: string; ledger?: boolean } = {}) => {
  if (o.required) {
    const pm = path.join(projects, "acme", "project.md");
    const t = readFileSync(pm, "utf8");
    if (!t.includes("context.required")) writeFileSync(pm, t.replace("| tone |", `| context.required | ${o.required} | 2026-11-15 | owner |\n| tone |`));
  }
  return recordDraftCall(recordCall({ email: p.email, subject: p.subject ?? `Re: ${p.email}`, mailRef: p.mailRef }, p.record), { dbPath: db, attempts: 1, projectsDir: projects, policyDir: policy, ...(o.ledger === false ? {} : { ledgerRoot: root }), now: () => new Date(o.now ?? "2026-11-16T10:00:00Z") });
};
const bare = (email: string): Rec => ({ email, mailRef: `<${email}>`, subject: "s", record: { name: "A" } });
const count = async () => {
  const h = openDb(db);
  try {
    return (await createRepos(h.db).clients.list("acme")).length;
  } finally {
    h.close();
  }
};

describe("the record's context block (B1)", () => {
  it("no context in warn mode: recorded, evidence missing", async () => {
    expect(await run(bare("a@x.example"))).toMatchObject({ ok: true, evidence: "missing", warnings: [expect.stringContaining("context-missing")] });
  });
  it("no context in block mode: refused, nothing written", async () => {
    expect(await run(bare("a@x.example"), { required: "block" })).toMatchObject({ ok: false, code: "context_refused", warnings: [expect.stringContaining("context-missing")] });
    expect(await count()).toBe(0);
  });
  it("the default flips from warn to block on 2026-11-22", async () => {
    expect(await run(bare("a@x.example"), { now: "2026-11-21T12:00:00Z" })).toMatchObject({ ok: true });
    expect(await run(bare("a@x.example"), { now: "2026-11-22T12:00:00Z" })).toMatchObject({ ok: false, code: "context_refused" });
  });
  it("a complete block is ok and is stored in the records ledger without any body", async () => {
    expect(await run(reply("a@x.example", ctx()))).toMatchObject({ ok: true, evidence: "ok", source: "claimed", warnings: [] });
    const lines = readLines<RecordLine>(recordsFile(root, "acme"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ batchKey: "bulk-1", email: "a@x.example", evidence: "ok" });
    expect(Object.keys(lines[0]!)).not.toContain("body");
  });
  it("a failing block in warn mode is recorded as weak with the reasons; in block mode refused", async () => {
    const bad = ctx({ facts: { queries: 0, used: [], missing: [] } });
    expect(await run(reply("a@x.example", bad))).toMatchObject({ ok: true, evidence: "weak", warnings: [expect.stringContaining("no-facts-query")] });
    expect(await run(reply("b@x.example", bad), { required: "block" })).toMatchObject({ ok: false, code: "context_refused", error: expect.stringContaining("no-facts-query") });
  });
  it("no read at all is evidence missing; an unknown key is refused by the record schema", async () => {
    const none = ctx({ thread: { firstContact: false, found: 3, read: 0, readIds: [], cited: [] } });
    expect(await run(reply("a@x.example", none))).toMatchObject({ ok: true, evidence: "missing" });
    expect(draftRecord.safeParse({ context: { ...ctx(), surprise: 1 } }).success).toBe(false);
  });
  it("the same anchor in two drafts of one batch is flagged on the second", async () => {
    await run(reply("a@x.example", ctx()));
    const r = okOf(await run(reply("b@x.example", ctx())));
    expect(r.evidence).toBe("weak");
    expect(r.warnings.join()).toContain("anchor-duplicate");
  });
  it("without a ledger root nothing is read or written", async () => {
    expect(await run(reply("a@x.example", ctx()), { ledger: false })).toMatchObject({ ok: true, evidence: "ok" });
    expect(readLines<RecordLine>(recordsFile(root, "acme"))).toEqual([]);
  });
});

describe("the record cross-checked with the session's ledger (B5)", () => {
  const M = "mcp__mail-mcp__";
  const t = (x: unknown) => [{ type: "text", text: JSON.stringify(x) }];
  const session = (calls: Array<{ name: string; input: unknown; result?: unknown }>) => {
    const e: LedgerEntry[] = [];
    replayCalls(calls, e, []);
    for (const x of e) appendLine(sessionFile(root, "acme", "S1"), { sid: "S1", ...x });
  };
  /** The hub's reply draft (P129 A3: `message` names the answered message; the record rides along). */
  const write = (id: number, body: string) => ({ name: "mcp__hub__draft_write", input: { kind: "reply", message: { account: "a", mailbox_path: ["INBOX"], message_id: id }, content: body, record: {} }, result: t({ draftId: 9000 + id, thread: `m${id}@x`, replyTo: id, account: "a", sent: false, recorded: true }) });
  const careful = (id: number, who: string, body: string) => [
    { name: "mcp__notion__notion-query-data-sources", input: { query: `Email = ${who}` }, result: t([]) },
    { name: `${M}find_messages`, input: { account: "a", mailboxPath: ["INBOX"], sender: who }, result: t([{ id: id }, { id: id - 1 }, { id: id - 2 }]) },
    ...[id, id - 1, id - 2].map((i) => ({ name: `${M}get_message_content`, input: { account: "a", mailboxPath: ["INBOX"], message_id: i }, result: t({ id: i, from: `W <${who}>` }) })),
    { name: "mcp__hub__knowledge_search", input: { query: "q" }, result: t([]) },
    write(id, body),
  ];

  it("takes the body sketch from the ledger and marks the record observed", async () => {
    session(careful(30, "a@x.example", "Hello, your lot 14 certificate arrived and the Harbour Road plan matches the survey."));
    expect(await run(reply("a@x.example", ctx()))).toMatchObject({ ok: true, evidence: "ok", source: "observed" });
    expect(readLines<RecordLine>(recordsFile(root, "acme"))[0]!.fp!.length).toBeGreaterThan(0);
  });

  it("claim-exceeds-observation: claims 3 read, the session opened 1", async () => {
    session([
      { name: `${M}find_messages`, input: { account: "a", mailboxPath: ["INBOX"], sender: "a@x.example" }, result: t([{ id: 30 }, { id: 29 }, { id: 28 }]) },
      { name: `${M}get_message_content`, input: { account: "a", mailboxPath: ["INBOX"], message_id: 30 }, result: t({ id: 30, from: "W <a@x.example>" }) },
      write(30, "A reply."),
    ]);
    const r = okOf(await run(reply("a@x.example", ctx())));
    expect(r.evidence).toBe("weak");
    expect(r.warnings.join()).toContain("claim-exceeds-observation");
  });

  it("flags a near-copy of an earlier draft of the batch and names it", async () => {
    const body = (n: string) => `Hi ${n},\n\nThank you for your message and for your patience. We have received your question and our team is reviewing the details of your property now. We will come back to you in the next few days with the information you need, and please contact us if anything changes in the meantime.\n\nKind regards, the desk`;
    session([...careful(30, "a@x.example", body("Anna")), ...careful(40, "b@x.example", body("Boris"))]);
    await run(reply("a@x.example", ctx({ anchors: ["asked for the certificate of title"] })));
    const r = okOf(await run(reply("b@x.example", ctx({ anchors: ["asked about the vineyard plot above the lane"], personalization: "Answers the vineyard plot question he raised in his second message of November." }))));
    expect(r.similarTo).toBe("a@x.example");
    expect(r.warnings.join()).toContain("near-duplicate");
  });
});

describe("a revision keeps what it does not restate (P52)", () => {
  const card = async (email: string) => {
    const h = openDb(db);
    try {
      const r = createRepos(h.db);
      const id = (await r.clients.idByEmail("acme", email))!;
      const d = (await r.drafts.ofClient("acme", id))[0]!;
      return { name: (await r.clients.get("acme", id))!.name, context: d.context, evidence: d.evidence, findings: JSON.parse(d.evidenceFindings ?? "[]") as Array<{ code: string; amber: boolean }>, checked: d.checked, id: d.id };
    } finally {
      h.close();
    }
  };

  it("the name, the context block and the Notion link carry over; no red check; Checked off", async () => {
    const email = "fiona@x.example";
    expect(await run({ email, subject: "Re: Lot 14", mailRef: "<m-fiona@x>", record: { name: "Fiona Park", context: ctx(), notion: { kind: "none" } } }, { ledger: false })).toMatchObject({ ok: true, action: "created" });
    const before = await card(email);
    // the dock's revision: a bare record, the client's address as the name, no context
    expect(await run({ email, subject: "Re: Lot 14", mailRef: "m-fiona@x", record: { name: email, excerpt: "Shorter now." } }, { ledger: false })).toMatchObject({ ok: true, action: "updated", draftId: before.id });
    const after = await card(email);
    expect(after.name).toBe("Fiona Park");
    expect(after.context).toBe(before.context);
    expect(after.findings.filter((f) => !f.amber)).toEqual([]);
    expect(after.findings.map((f) => f.code)).not.toContain("context-missing");
    expect(after.evidence).not.toBe("missing");
    expect(after.checked).toBe(false);
  });

  it("a thin earlier revision is healed from the ledger line that had the context", async () => {
    const email = "gil@x.example";
    await run({ email, subject: "Re: Pump", mailRef: "<m-gil@x>", record: { name: "Gil", context: ctx({ batchKey: "b-gil" }) } });
    // a thin record overwrote the context (what v0.12.0 allowed)
    const h = openDb(db);
    try {
      h.db.$client.prepare("update drafts set context = null").run();
    } finally {
      h.close();
    }
    await run({ email, subject: "Re: Pump", mailRef: "<m-gil@x>", record: {} });
    const after = await card(email);
    expect(after.name).toBe("Gil");
    expect(after.context).toContain("certificate of title");
    expect(after.findings.map((f) => f.code)).not.toContain("context-missing");
  });
});
