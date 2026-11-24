import { beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb } from "@hub/db";
import { recordDraftCall } from "../src/records/draft";
import { draftRecord } from "../src/records/schema";
import { recordCall, recordsInstance } from "./records-fixture";

// The record's context block (P28 B1; P52; P140 K2): what `draft_write`'s record carries in `record.context` is stored for the
// card as the agent stated it and never judged (owner, 2026-11-24: the agent follows the workflow). A revision keeps it.

let db: string;
let projects: string;
let policy: string;
beforeEach(() => {
  ({ db, projects, policy } = recordsInstance());
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
const run = (p: Rec) => recordDraftCall(recordCall({ email: p.email, subject: p.subject ?? `Re: ${p.email}`, mailRef: p.mailRef }, p.record), { dbPath: db, attempts: 1, projectsDir: projects, policyDir: policy });
const card = async (email: string) => {
  const h = openDb(db);
  try {
    const r = createRepos(h.db);
    const id = (await r.clients.idByEmail("acme", email))!;
    const d = (await r.drafts.ofClient("acme", id))[0]!;
    return { name: (await r.clients.get("acme", id))!.name, context: d.context, findings: JSON.parse(d.findings ?? "[]") as Array<{ code: string }>, batchKey: d.batchKey, checked: d.checked, id: d.id };
  } finally {
    h.close();
  }
};

describe("the record's context block is stored, never judged (P140 K2)", () => {
  it("no context, no read, a duplicate anchor: each is recorded with no warning and no refusal", async () => {
    expect(await run({ email: "a@x.example", mailRef: "<a@x.example>", subject: "s", record: { name: "A" } })).toMatchObject({ ok: true, warnings: [] });
    expect(await run(reply("b@x.example", ctx({ thread: { firstContact: false, found: 3, read: 0, readIds: [], cited: [] }, facts: { queries: 0, used: [], missing: [] } })))).toMatchObject({ ok: true, warnings: [] });
    expect(await run(reply("c@x.example", ctx()))).toMatchObject({ ok: true, warnings: [] });
    expect(await run(reply("d@x.example", ctx()))).toMatchObject({ ok: true, warnings: [] });
    const c = await card("c@x.example");
    expect(JSON.parse(c.context ?? "{}")).toMatchObject({ anchors: ["asked for the certificate of title"] });
    expect(c.batchKey).toBe("bulk-1");
    expect(c.findings).toEqual([]);
  });
  it("an unknown key is still refused by the record schema", () => {
    expect(draftRecord.safeParse({ context: { ...ctx(), surprise: 1 } }).success).toBe(false);
  });
});

describe("a revision keeps what it does not restate (P52)", () => {
  it("the name, the context block and the Notion link carry over; Checked off", async () => {
    const email = "fiona@x.example";
    expect(await run({ email, subject: "Re: Lot 14", mailRef: "<m-fiona@x>", record: { name: "Fiona Park", context: ctx(), notion: { kind: "none" } } })).toMatchObject({ ok: true, action: "created" });
    const before = await card(email);
    // the dock's revision: a bare record, the client's address as the name, no context
    expect(await run({ email, subject: "Re: Lot 14", mailRef: "m-fiona@x", record: { name: email, excerpt: "Shorter now." } })).toMatchObject({ ok: true, action: "updated", draftId: before.id });
    const after = await card(email);
    expect(after.name).toBe("Fiona Park");
    expect(after.context).toBe(before.context);
    expect(after.checked).toBe(false);
  });
});
