import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { storeToken } from "@hub/connections";
import { projectRows, projectTable } from "../src/project-table";
import { verifyProjectDatabases } from "../src/notion-check";
import { projectStore } from "@hub/projects";
import { fake } from "./helpers";

const ID = "00000000-0000-4000-8000-000000000001";
const row = (k: string, v: string) => `| ${k} | ${v} | 2026-11-15 | owner |`;
const md = (slug: string, status: string) =>
  ["# " + slug, "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", row("schema", "1"), row("status", status), row("mail.accounts", "owner@example.com"), row("notion.teamspace", "Acme teamspace"), "", "## Notion databases", "", `- clients: ${ID}`, ""].join("\n");

function projectsDir(f: ReturnType<typeof fake>, list: [string, string][]): string {
  const dir = path.join(f.root, "app", "projects");
  for (const [slug, status] of list) { mkdirSync(path.join(dir, slug), { recursive: true }); writeFileSync(path.join(dir, slug, "project.md"), md(slug, status)); }
  mkdirSync(path.join(dir, "_template"), { recursive: true });
  writeFileSync(path.join(dir, "_template", "project.md"), md("_template", "active"));
  return dir;
}

describe("notion databases and project table", () => {
  it("names the teamspace page to share when a database is unreachable", async () => {
    const f = fake();
    storeToken(f.ctx.configDir, "notion-token", "ntn\u005fTESTTOKENVALUE123456");
    f.ctx.fetch = (async () => new Response("{}", { status: 404 })) as any;
    const v = await verifyProjectDatabases(f.ctx, projectStore({ projects: projectsDir(f, [["acme", "active"]]) }).list());
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('share the teamspace page "Acme teamspace"');
  });
  it("one table over all projects, paused ones included, status untouched", async () => {
    const f = fake();
    const dir = projectsDir(f, [["acme", "active"], ["gamma", "paused"]]);
    const text = projectTable(await projectRows(dir));
    expect(text).toMatch(/acme\s+generic\s+active/);
    expect(text).toMatch(/gamma\s+generic\s+paused/);
    expect(text).not.toContain("_template");
  });
  it("the table shows the mail failure the project doctor shows: an empty Mail account list is an answer, not an absent one", async () => {
    const f = fake();
    const dir = projectsDir(f, [["acme", "active"]]);
    const base = (await projectRows(dir))[0]!;
    const rows = await projectRows(dir, { mailAccounts: async () => [] });
    expect(rows[0]!.failed).toBe(base.failed + 1);
    const same = await projectRows(dir, { mailAccounts: async () => ["owner@example.com"] });
    expect(same[0]!.failed).toBe(base.failed);
    const unread = await projectRows(dir, { mailAccounts: async () => { throw new Error("down"); } });
    expect(unread[0]!.failed).toBe(base.failed); // Mail could not be asked: skipped, not guessed
  });
  it("a Notion read that was skipped (no token) is a skipped row, never a pass", async () => {
    const f = fake();
    const dir = projectsDir(f, [["acme", "active"]]);
    const base = (await projectRows(dir))[0]!;
    const skipped = (await projectRows(dir, { notionCheck: async () => ({ ok: true, skipped: true, detail: "no Notion token file" }) }))[0]!;
    const passed = (await projectRows(dir, { notionCheck: async () => ({ ok: true, detail: "1/1 readable" }) }))[0]!;
    expect(skipped.passed).toBe(base.passed);
    expect(passed.passed).toBe(base.passed + 1);
    const failed = (await projectRows(dir, { notionCheck: async () => ({ ok: false, detail: "clients: archived" }) }))[0]!;
    expect(failed.failed).toBe(base.failed + 1);
  });
});
