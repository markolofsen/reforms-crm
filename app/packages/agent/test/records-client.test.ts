import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb } from "@hub/db";
import type { HubMcpEnv } from "../src/mcp/ports";
import { createHubMcpServer } from "../src/mcp/server";
import { recordClientCall } from "../src/records/client";
import { recordDraftCall } from "../src/records/draft";
import { clientRecord } from "../src/records/schema";
import { beforeContextBlock, recordCall } from "./records-fixture";

// `client_record` (P129 A3, decision 0045 point 10; a hub tool, no shell command any more): a client the session handled WITHOUT a
// draft, one Inbox row and no mail text; and the Inbox row and evidence a drafted client gets from draft_write's record.

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rc-"));
  dbPath = path.join(dir, "app.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const send = (p: object, project = "acme") => recordClientCall(project, clientRecord.parse(p), { dbPath });
const draft = (c: { email: string; mailRef: string }, record: Record<string, unknown>, now: () => Date = beforeContextBlock) =>
  recordDraftCall(recordCall({ email: c.email, subject: "Re", mailRef: c.mailRef }, record), { dbPath, now });
const ID = "0123456789abcdef0123456789abcdef";

async function rows(filter: "all" | "owed" = "all") {
  const h = openDb(dbPath);
  try {
    return await createRepos(h.db).inbox.list("acme", filter);
  } finally {
    h.close();
  }
}

describe("client_record", () => {
  it("records a skipped client with a lead page and stores no mail text", async () => {
    expect(await send({ email: "a@x.example", name: "Ann", action: "skipped", reason: "newsletter", notion: { kind: "lead", page_id: ID } })).toMatchObject({ ok: true, created: true });
    expect(await rows()).toMatchObject([{ email: "a@x.example", action: "skipped", notionKind: "lead", notionPageId: ID, owed: false }]);
  });

  it("an escalated client is owed an answer", async () => {
    await send({ email: "b@x.example", action: "escalated", reason: "legal", notion: { kind: "none" } });
    expect((await rows("owed")).map((r) => r.email)).toEqual(["b@x.example"]);
  });

  it("refuses a body, an unknown key, an unknown action and a page without an id", () => {
    for (const p of [
      { email: "a@x.example", action: "skipped", notion: { kind: "none" }, body: "hello" },
      { email: "a@x.example", action: "sent", notion: { kind: "none" } },
      { email: "a@x.example", action: "skipped" },
      { email: "a@x.example", action: "skipped", notion: { kind: "client" } },
      { email: "a@x.example", action: "skipped", notion: { kind: "none", page_id: ID } },
      { email: "a@x.example", action: "skipped", notion: { kind: "client", page_id: "short" } },
      { email: "a@x.example", action: "skipped", notion: { kind: "lead", pageId: ID } },
    ]) expect(clientRecord.safeParse(p).success, JSON.stringify(p)).toBe(false);
  });

  it("normalises a dashed page id", async () => {
    await send({ email: "a@x.example", action: "skipped", notion: { kind: "client", page_id: "01234567-89ab-cdef-0123-456789abcdef" } });
    expect((await rows())[0]?.notionPageId).toBe(ID);
  });

  it("records a call with a free-text phone, and refuses an unknown kind and a body", async () => {
    expect(await send({ email: "d@x.example", name: "Di", action: "escalated", kind: "call", phone: "ask at the front desk", replies_owed: false, notion: { kind: "none" } })).toMatchObject({ ok: true });
    const h = openDb(dbPath);
    try {
      expect(await createRepos(h.db).inbox.notByEmail("acme", "call")).toMatchObject([{ email: "d@x.example", kind: "call", phone: "ask at the front desk" }]);
    } finally {
      h.close();
    }
    expect(clientRecord.safeParse({ email: "e@x.example", action: "skipped", kind: "send_it", notion: { kind: "none" } }).success).toBe(false);
    expect(clientRecord.safeParse({ email: "e@x.example", action: "skipped", kind: "call", body: "hi", notion: { kind: "none" } }).success).toBe(false);
    expect(await rows("owed")).toEqual([]);
  });

  it("is a hub mcp tool on the records port: it writes the bound project's row; a bad input or no port writes nothing", async () => {
    const h = openDb(dbPath);
    try {
      const connect = async (env: Partial<HubMcpEnv>) => {
        const server = createHubMcpServer(createRepos(h.db), { hubProject: "acme", focusFile: path.join(dir, "focus.json"), ...env });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await server.connect(b);
        const client = new Client({ name: "test", version: "0" });
        await client.connect(a);
        return async (args: Record<string, unknown>) => {
          const res = await client.callTool({ name: "client_record", arguments: args });
          return { isError: res.isError === true, text: (res.content as Array<{ text: string }>)[0]!.text };
        };
      };
      const call = await connect({ records: { dbPath } });
      const ok = await call({ email: "f@x.example", name: "Fay", action: "skipped", reason: "a newsletter", notion: { kind: "none" } });
      expect(ok.isError).toBe(false);
      expect(JSON.parse(ok.text)).toMatchObject({ ok: true, project: "acme", created: true });
      expect((await call({ email: "g@x.example", action: "skipped", notion: { kind: "none" }, body: "hello" })).isError).toBe(true);
      expect(JSON.parse((await (await connect({}))({ email: "g@x.example", action: "skipped", notion: { kind: "none" } })).text)).toMatchObject({ error: "unavailable" });
      expect((await rows()).map((r) => r.email)).toEqual(["f@x.example"]);
    } finally {
      h.close();
    }
  });
});

describe("a drafted client: the Inbox row and the evidence draft_write's record stores", () => {
  it("states the notion kind and lists the drafted client in the inbox; an unstated kind is noticed", async () => {
    const r = await draft({ email: "c@x.example", mailRef: "<c@x>" }, { name: "Cy", notion: { kind: "client", url: `https://www.notion.so/Cy-${ID}` } });
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.notice).toBeFalsy();
    expect(await rows()).toMatchObject([{ email: "c@x.example", action: "drafted", notionKind: "client", owed: false }]);
    expect(await draft({ email: "d@x.example", mailRef: "<d@x>" }, {})).toMatchObject({ ok: true, notice: expect.stringMatching(/notion not stated/) });
  });

  it("a complete context lands as basedOn with its own evidence level; none lands as missing and red", async () => {
    const ctx = { batchKey: "k1", thread: { firstContact: false, found: 1, read: 1, readIds: [7], cited: [7], newest: "2026-11-10", rows: [{ date: "2026-11-10", who: "Cy", subject: "Terms", excerpt: "Can you confirm the terms?" }] }, profile: { read: true, state: "filled", editedAt: "2026-11-01" }, facts: { queries: 1, used: ["k-1"], missing: [] }, anchors: ["asked to confirm the terms of the second unit"], personalization: "Cy asked about the terms of the second unit in Lisbon, not the first." };
    await draft({ email: "cy@x.example", mailRef: "<cy@x>" }, { name: "Cy", notion: { kind: "client", page_id: ID }, last_contact_at: "2026-11-10T09:00:00Z", replies_owed: true, context: ctx }, () => new Date("2026-12-01T09:00:00Z")); // a complete block passes once block mode applies
    await draft({ email: "no@x.example", mailRef: "<no@x>" }, { name: "No" });
    const h = openDb(dbPath);
    try {
      const all = await createRepos(h.db).clients.review("acme", "all");
      const by = Object.fromEntries(all.map((d) => [d.client.email, d]));
      expect(by["cy@x.example"]?.basedOn).toMatchObject({ level: "ok", context: { thread: { read: 1, rows: [{ who: "Cy" }] } } });
      expect(by["no@x.example"]?.basedOn).toMatchObject({ level: "missing" });
      expect(by["no@x.example"]?.safetyResults.some((r) => r.kind === "no_thread_read" && r.level === "red")).toBe(true);
      expect(by["no@x.example"]?.blocked).toBe(true);
      expect(by["cy@x.example"]?.body).toBe("");
    } finally {
      h.close();
    }
  });
});
