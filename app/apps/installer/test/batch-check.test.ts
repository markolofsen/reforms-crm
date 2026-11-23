import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { replayCalls, type LedgerEntry } from "@hub/projects";
import { appendLine, sessionFile } from "@hub/projects/evidence-store";
import { batchCheck, batchLines } from "../src/batch-check";
import { anyRecipients, FIXTURE_PROJECTS } from "./instance-fixture";
import { recordFlat } from "./support/seed-draft-impl";

// `hub batch-check` (P28 B5) over the records ledger that draft_write's writer appends (the writer's own checks are
// `@hub/agent`'s records-context.test.ts): a batch of near-copies is red, a clean one green, an unknown one empty.

let db: string;
let root: string;
let projects: string;
let policy: string;
beforeEach(() => {
  const d = mkdtempSync(path.join(tmpdir(), "hub-batch-"));
  db = path.join(d, "app.db");
  root = path.join(d, "root");
  projects = path.join(d, "projects");
  mkdirSync(root);
  cpSync(path.join(FIXTURE_PROJECTS, "acme-travel"), path.join(projects, "acme"), { recursive: true });
  policy = anyRecipients(path.join(d, "policy"), "acme");
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
const run = (email: string, c: unknown) => recordFlat("acme", { email, name: email, subject: `Re: ${email}`, mailRef: `<${email}>`, context: c }, { dbPath: db, attempts: 1, projectsDir: projects, policyDir: policy, ledgerRoot: root, now: () => new Date("2026-11-16T10:00:00Z") });

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
  { name: "mcp__hub__knowledge_search", input: { query: "q" }, result: t([]) },
  { name: "mcp__hub__draft_write", input: { kind: "reply", message: { account: "a", mailbox_path: ["INBOX"], message_id: id }, content: body, record: {} }, result: t({ draftId: 9000 + id, replyTo: id, account: "a", sent: false, recorded: true }) },
];

describe("batch-check over the records ledger (B5)", () => {
  it("a near-copy of an earlier draft of the batch turns the batch table red and lists the closest pair", async () => {
    const body = (n: string) => `Hi ${n},\n\nThank you for your message and for your patience. We have received your question and our team is reviewing the details of your property now. We will come back to you in the next few days with the information you need, and please contact us if anything changes in the meantime.\n\nKind regards, the desk`;
    session([...careful(30, "a@x.example", body("Anna")), ...careful(40, "b@x.example", body("Boris"))]);
    expect(await run("a@x.example", ctx({ anchors: ["asked for the certificate of title"] }))).toMatchObject({ ok: true });
    expect(await run("b@x.example", ctx({ anchors: ["asked about the vineyard plot above the lane"], personalization: "Answers the vineyard plot question he raised in his second message of November." }))).toMatchObject({ ok: true, similarTo: "a@x.example" });
    const rep = batchCheck(root, "acme", "bulk-1");
    expect(rep.counts.total).toBe(2);
    expect(rep.red).toBe(true);
    expect(rep.pairs[0]!.sim).toBeGreaterThan(0.8);
    expect(batchLines(rep).join("\n")).toContain("closest pairs");
  });

  it("a batch with nothing red is green; an unknown batch has no rows", async () => {
    expect(await run("a@x.example", ctx())).toMatchObject({ ok: true });
    expect(batchCheck(root, "acme", "bulk-1")).toMatchObject({ red: false, counts: { total: 1, ok: 1 } });
    expect(batchCheck(root, "acme", "nope").rows).toEqual([]);
  });
});
