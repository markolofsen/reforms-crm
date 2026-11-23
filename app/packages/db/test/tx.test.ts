import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "../src/client";
import { createRepos } from "../src/repos";
import { write } from "../src/tx";

let dir: string;
let file: string;
let handle: DbHandle;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hub-tx-"));
  file = join(dir, "t.db");
  handle = openDb(file);
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("write transactions", () => {
  it("take the write lock before the first statement, so another process waits instead of failing later", () => {
    let refused = "";
    write(handle.db, () => {
      // A second connection (the CLI) asking for the write lock with no wait: refused while ours is open.
      const other = new Database(file, { timeout: 0 });
      try {
        other.exec("BEGIN IMMEDIATE");
      } catch (e) {
        refused = e instanceof Error ? e.message : String(e);
      } finally {
        other.close();
      }
    });
    expect(refused).toMatch(/locked|busy/i);
  });

  it("a repository writer sees a row another connection committed first (no stale snapshot)", async () => {
    const repos = createRepos(handle.db);
    const clientId = await repos.clients.create({ project: "p", email: "a@x.example", name: "A" });
    const draftId = await repos.drafts.create({ project: "p", clientId, subject: "s", toAddr: "a@x.example", body: "b", status: "ready" });
    const other = new Database(file);
    other.prepare("update drafts set status = 'hold' where id = ?").run(draftId);
    other.close();
    expect((await repos.drafts.setStatus(draftId, "done"))?.prevStatus).toBe("hold");
  });
});
