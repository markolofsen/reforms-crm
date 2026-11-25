import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb } from "@hub/db";
import type { BugReportInput, BugReportResult } from "@hub/notion/bug-reports";
import type { HubMcpEnv } from "../src/mcp/ports";
import { createHubMcpServer } from "../src/mcp/server";

// P145 B3 (verdict 17): `bug_report` resolves the client, the channel and the Source link from the conversation (the agent never
// types them), names the project by its key, and turns the writer's outcomes into answers and refusals.
let dir: string;
let dbPath: string;
let anaId: number;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "br-"));
  dbPath = path.join(dir, "app.db");
  const h = openDb(dbPath);
  try {
    anaId = (h.db.$client.prepare("INSERT INTO clients (project, email, name, updated_at) VALUES ('acme', 'ana@x.example', 'Ana', '2026-11-24T00:00:00.000Z') RETURNING id").get() as { id: number }).id;
  } finally {
    h.close();
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function connect(file: (i: BugReportInput) => BugReportResult, env: Partial<HubMcpEnv> = {}) {
  const h = openDb(dbPath);
  const seen: BugReportInput[] = [];
  const server = createHubMcpServer(createRepos(h.db), {
    hubProject: "acme",
    focusFile: path.join(dir, "focus.json"),
    now: () => new Date("2026-11-25T10:00:00.000Z"),
    projectConfig: () => ({ brands: [{ name: "Shop One" }, { name: "Other Site" }] }) as never,
    adminOrigin: () => "http://127.0.0.1:5173",
    fileBugReport: async (_slug, i) => (seen.push(i), file(i)),
    ...env,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  const call = async (args: Record<string, unknown>) => {
    const res = await client.callTool({ name: "bug_report", arguments: args });
    return { isError: res.isError === true, text: (res.content as Array<{ text: string }>)[0]!.text };
  };
  return { call, seen, close: () => h.close() };
}

const ARGS = { message: "<m1@x.example>", project: "shop-one", area: "parser: source-a", symptom: "Gallery shows another car's photos", words: "the photos are of other cars", evidence: ["https://example.test/car/1"] };

describe("bug_report", () => {
  it("a Mail client: the tool fills the client, channel and link; the project is the brand row of the key", async () => {
    const t = await connect(() => ({ state: "created", pageId: "rep-1", note: null }));
    try {
      const r = await t.call({ ...ARGS, client: anaId });
      expect(r.isError, r.text).toBe(false);
      expect(JSON.parse(r.text)).toMatchObject({ project: "acme", state: "created", report: "rep-1", client: anaId });
      expect(JSON.parse(r.text).next).toMatch(/promise no date and no cause/);
      expect(t.seen[0]).toMatchObject({ project: "Shop One", channel: "Mail", clientEmail: "ana@x.example", sourceLink: "http://127.0.0.1:5173/acme/mail/c/ana%40x.example", messageKey: "acme:<m1@x.example>" });
    } finally {
      t.close();
    }
  });

  it("several open reports, no database, a failed write: each is a refusal naming what to do", async () => {
    for (const [out, code] of [
      [{ state: "several", candidates: [{ pageId: "a", bug: "x" }, { pageId: "b", bug: "y" }] }, "bug_report_several"],
      [{ state: "no_database", detail: "no bug-reports" }, "no_bug_database"],
      [{ state: "failed", detail: "HTTP 500" }, "notion_unavailable"],
    ] as const) {
      const t = await connect(() => out as BugReportResult);
      try {
        const r = await t.call({ ...ARGS, client: anaId });
        expect(r.isError).toBe(true);
        expect(JSON.parse(r.text).error).toBe(code);
      } finally {
        t.close();
      }
    }
  });

  it("refuses without a conversation, with two, and another project's or a follow-up turn's other client", async () => {
    const t = await connect(() => ({ state: "created", pageId: "rep-1", note: null }), { followUpClient: anaId + 1 });
    try {
      expect(JSON.parse((await t.call(ARGS)).text).error).toBe("invalid");
      expect(JSON.parse((await t.call({ ...ARGS, client: anaId })).text).error).toBe("followup_other_client");
      expect(t.seen).toEqual([]);
    } finally {
      t.close();
    }
  });
});
