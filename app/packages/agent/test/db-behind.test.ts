import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, openDbReadOnly, type DbHandle } from "@hub/db";
import { createHubMcpServer } from "../src/mcp/server";
import { run } from "../src/mcp/result";

// P141 guard, the read side (2026-11-25): a dock `hub mcp` on a database the server has not migrated answered
// `messenger_history` with "no such column last_outbound_at". Every tool now refuses with db_behind and the restart line.

let dir: string;
let h: DbHandle;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-db-behind-"));
  h = openDb(path.join(dir, "app.db"));
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(behind: number, name: string, args: Record<string, unknown> = {}) {
  const server = createHubMcpServer(createRepos(h.db), { hubProject: "acme", focusFile: path.join(dir, "focus.json"), dbBehind: () => behind });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError === true, json: JSON.parse((r.content as Array<{ text: string }>)[0]!.text) as Record<string, unknown> };
}

describe("a database behind this core", () => {
  it("a read-only handle counts the migrations it lacks: none on a current file", () => {
    const ro = openDbReadOnly(path.join(dir, "app.db"));
    try {
      expect(ro.behind?.()).toBe(0);
    } finally {
      ro.close();
    }
  });

  it("every tool refuses with db_behind and the restart line while it is behind, and works once it is not", async () => {
    const r = await call(1, "messenger_history", { channel: "telegram_user", chat_id: "1" });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: "db_behind", retry: "after_owner" });
    expect(String(r.json.message)).toMatch(/restart the Hub server/);
    expect((await call(0, "focus")).isError).toBe(false);
  });

  it("a raw SQLite schema error or a DbBehindError becomes db_behind, never the SQL text", async () => {
    const sql = Object.assign(new Error("no such column: last_outbound_at"), { name: "SqliteError" });
    const behind = Object.assign(new Error("The database is 1 migration(s) behind"), { name: "DbBehindError" });
    for (const e of [sql, behind]) {
      const reply = await run(async () => {
        throw e;
      });
      expect(JSON.parse((reply.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ error: "db_behind" });
    }
  });
});
