import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { leadDto } from "../../src/mail/inbound-view";

let dir: string;
let h: DbHandle;
let repos: Repos;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hub-lead-state-")); h = openDb(join(dir, "app.db")); repos = createRepos(h.db); });
afterEach(() => { h.close(); rmSync(dir, { recursive: true, force: true }); });

it("manual resolutions keep their labels without inventing an agent decision; restore returns the same request to Needs you", async () => {
  const page = (n: number) => String(n).repeat(32);
  await repos.leadRows.sync([1, 2, 3].map((n) => ({ project: "p", pageId: page(n), name: `Lead ${n}`, email: `lead${n}@example.test`, accountEmail: null, brand: null, receivedAt: "2026-11-20T10:00:00Z", preview: "Access please", notionStatus: n === 3 ? "In progress" : "New", hasClient: false })));
  await repos.leadRows.dismiss("p", page(1), "not_now");
  await repos.leadRows.dismiss("p", page(2), "spam");
  const all = await repos.leadRows.views("p", "all", "2026-11-01");
  expect(all.counts).toMatchObject({ needs_you: 0, all: 3, not_now: 1, spam: 1 });
  for (const [n, display] of [[1, "not_now"], [2, "spam"], [3, "notion"]] as const) {
    const row = await repos.leadRows.get("p", page(n));
    expect(row).not.toBeNull();
    const list = all.rows.find((r) => r.pageId === page(n));
    expect(list).toBeDefined();
    expect(leadDto(list!)).toMatchObject({ display, pass: null });
    expect(leadDto(row!)).toMatchObject({ display, pass: null });
  }
  await repos.leadRows.undismiss("p", page(1));
  const restored = await repos.leadRows.views("p", "needs_you", "2026-11-01");
  expect(restored.total).toBe(1);
  expect(leadDto(restored.rows[0]!)).toMatchObject({ display: "new", pass: null });
});
