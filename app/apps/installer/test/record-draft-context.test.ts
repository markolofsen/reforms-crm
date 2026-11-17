import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb } from "@hub/db";
import { replayCalls, type LedgerEntry } from "@hub/projects";
import { defaultRoot } from "../src/context";
import { batchCheck, batchLines } from "../src/batch-check";
import { appendLine, readLines, recordsFile, sessionFile } from "../src/evidence-store";
import { recordDraft, type RecordLine } from "../src/record-draft";

let db: string;
let root: string;
let projects: string;
beforeEach(() => {
  const d = mkdtempSync(path.join(tmpdir(), "hub-ctx-"));
  db = path.join(d, "app.db");
  root = path.join(d, "root");
  projects = path.join(d, "projects");
  mkdirSync(root);
  cpSync(path.join(defaultRoot(), "app", "packages", "projects", "test", "fixtures", "projects", "acme-travel"), path.join(projects, "acme"), { recursive: true });
  const pm = path.join(projects, "acme", "project.md");
  writeFileSync(pm, readFileSync(pm, "utf8").replace("| draft.recipients | test |", "| draft.recipients | any |"));
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
const payload = (email: string, c: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ email, name: email, subject: `Re: ${email}`, mailRef: `<${email}>`, context: c, ...extra });
const run = (p: string, o: { required?: "warn" | "block"; now?: string; ledger?: boolean } = {}) => {
  if (o.required) {
    const pm = path.join(projects, "acme", "project.md");
    const t = readFileSync(pm, "utf8");
    if (!t.includes("context.required")) writeFileSync(pm, t.replace("| tone |", `| context.required | ${o.required} | 2026-11-15 | owner |\n| tone |`));
  }
  return recordDraft({ project: "acme", payload: p, dbPath: db, attempts: 1, projectsDir: projects, ...(o.ledger === false ? {} : { ledgerRoot: root }), now: () => new Date(o.now ?? "2026-11-16T10:00:00Z") });
};
const count = async () => { const h = openDb(db); try { return (await createRepos(h.db).clients.list("acme")).length; } finally { h.close(); } };

describe("record-draft context (B1)", () => {
  it("no context in warn mode: recorded, evidence missing, exit 0", async () => {
    const r = await run(JSON.stringify({ email: "a@x.example", name: "A", subject: "s", mailRef: "<a>" }));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.line)).toMatchObject({ ok: true, evidence: "missing", mode: "warn", warnings: [expect.stringContaining("context-missing")] });
  });
  it("no context in block mode: refused with exit 2, nothing written", async () => {
    const r = await run(JSON.stringify({ email: "a@x.example", name: "A", subject: "s", mailRef: "<a>" }), { required: "block" });
    expect(r.code).toBe(2);
    expect(JSON.parse(r.line)).toMatchObject({ ok: false, evidence: "missing" });
    expect(await count()).toBe(0);
  });
  it("the default flips from warn to block on 2026-11-22", async () => {
    const p = JSON.stringify({ email: "a@x.example", name: "A", subject: "s", mailRef: "<a>" });
    expect((await run(p, { now: "2026-11-21T12:00:00Z" })).code).toBe(0);
    expect((await run(p, { now: "2026-11-22T12:00:00Z" })).code).toBe(2);
  });
  it("a complete block is ok and is stored in the records ledger without any body", async () => {
    const r = await run(payload("a@x.example", ctx()));
    expect(JSON.parse(r.line)).toMatchObject({ ok: true, evidence: "ok", source: "claimed", warnings: [] });
    const lines = readLines<RecordLine>(recordsFile(root, "acme"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ batchKey: "bulk-1", email: "a@x.example", evidence: "ok" });
  });
  it("a failing block in warn mode is recorded as weak with the reasons; in block mode refused", async () => {
    const bad = ctx({ facts: { queries: 0, used: [], missing: [] } });
    expect(JSON.parse((await run(payload("a@x.example", bad))).line)).toMatchObject({ ok: true, evidence: "weak", warnings: [expect.stringContaining("no-facts-query")] });
    const r = await run(payload("b@x.example", bad), { required: "block" });
    expect(r.code).toBe(2);
    expect(JSON.parse(r.line).error).toContain("no-facts-query");
  });
  it("no read at all is evidence missing; an unknown key is a bad payload", async () => {
    const none = ctx({ thread: { firstContact: false, found: 3, read: 0, readIds: [], cited: [] } });
    expect(JSON.parse((await run(payload("a@x.example", none))).line).evidence).toBe("missing");
    expect((await run(payload("b@x.example", { ...ctx(), surprise: 1 }))).code).toBe(2);
  });
  it("the same anchor in two drafts of one batch is flagged on the second", async () => {
    await run(payload("a@x.example", ctx()));
    const r = JSON.parse((await run(payload("b@x.example", ctx()))).line);
    expect(r.evidence).toBe("weak");
    expect(r.warnings.join()).toContain("anchor-duplicate");
  });
  it("without a ledger root nothing is read or written", async () => {
    expect(JSON.parse((await run(payload("a@x.example", ctx()), { ledger: false })).line)).toMatchObject({ ok: true, evidence: "ok" });
  });
});

describe("record-draft cross-check and batch-check (B5)", () => {
  const M = "mcp__mail-mcp__";
  const t = (x: unknown) => [{ type: "text", text: JSON.stringify(x) }];
  const session = (calls: Array<{ name: string; input: unknown; result?: unknown }>) => {
    const e: LedgerEntry[] = [];
    replayCalls(calls, e, []);
    for (const x of e) appendLine(sessionFile(root, "acme", "S1"), { sid: "S1", ...x });
  };
  const careful = (id: number, who: string, body: string) => [
    { name: "mcp__notion__notion-query-data-sources", input: { query: `Email = ${who}` }, result: t([]) },
    { name: `${M}find_messages`, input: { account: "a", mailboxPath: ["INBOX"], sender: who }, result: t([{ id: id }, { id: id - 1 }, { id: id - 2 }]) },
    ...[id, id - 1, id - 2].map((i) => ({ name: `${M}get_message_content`, input: { account: "a", mailboxPath: ["INBOX"], message_id: i }, result: t({ id: i, from: `W <${who}>` }) })),
    { name: "mcp__knowledge-mcp__knowledge_search", input: { project: "p", query: "q" }, result: t([]) },
    { name: `${M}create_reply`, input: { account: "a", mailbox_path: ["INBOX"], message_id: id, content: body }, result: t("ok") },
  ];

  it("takes the body sketch from the ledger and marks the record observed", async () => {
    session(careful(30, "a@x.example", "Hello, your lot 14 certificate arrived and the Harbour Road plan matches the survey."));
    const r = JSON.parse((await run(payload("a@x.example", ctx()))).line);
    expect(r).toMatchObject({ evidence: "ok", source: "observed" });
    expect(readLines<RecordLine>(recordsFile(root, "acme"))[0]!.fp!.length).toBeGreaterThan(0);
  });

  it("claim-exceeds-observation: claims 3 read, the session opened 1", async () => {
    session([
      { name: `${M}find_messages`, input: { account: "a", mailboxPath: ["INBOX"], sender: "a@x.example" }, result: t([{ id: 30 }, { id: 29 }, { id: 28 }]) },
      { name: `${M}get_message_content`, input: { account: "a", mailboxPath: ["INBOX"], message_id: 30 }, result: t({ id: 30, from: "W <a@x.example>" }) },
      { name: `${M}create_reply`, input: { account: "a", mailbox_path: ["INBOX"], message_id: 30, content: "A reply." }, result: t("ok") },
    ]);
    const r = JSON.parse((await run(payload("a@x.example", ctx()))).line);
    expect(r.evidence).toBe("weak");
    expect(r.warnings.join()).toContain("claim-exceeds-observation");
  });

  it("flags a near-copy of an earlier draft of the batch; the batch table goes red", async () => {
    const body = (n: string) => `Hi ${n},\n\nThank you for your message and for your patience. We have received your question and our team is reviewing the details of your property now. We will come back to you in the next few days with the information you need, and please contact us if anything changes in the meantime.\n\nKind regards, the desk`;
    session([...careful(30, "a@x.example", body("Anna")), ...careful(40, "b@x.example", body("Boris"))]);
    await run(payload("a@x.example", ctx({ anchors: ["asked for the certificate of title"] })));
    const r = JSON.parse((await run(payload("b@x.example", ctx({ anchors: ["asked about the vineyard plot above the lane"], personalization: "Answers the vineyard plot question he raised in his second message of November." })))).line);
    expect(r.similarTo).toBe("a@x.example");
    expect(r.warnings.join()).toContain("near-duplicate");
    const rep = batchCheck(root, "acme", "bulk-1");
    expect(rep.counts.total).toBe(2);
    expect(rep.red).toBe(true);
    expect(rep.pairs[0]!.sim).toBeGreaterThan(0.8);
    expect(batchLines(rep).join("\n")).toContain("closest pairs");
  });

  it("a batch with nothing red is green; an unknown batch has no rows", async () => {
    await run(payload("a@x.example", ctx()));
    expect(batchCheck(root, "acme", "bulk-1")).toMatchObject({ red: false, counts: { total: 1, ok: 1 } });
    expect(batchCheck(root, "acme", "nope").rows).toEqual([]);
  });
});
