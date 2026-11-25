import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyBugReports, bugReportsGaps, bugReportsPack, bugReportsRows, type BugProject } from "../src/notion-bug-reports";
import { fake } from "./helpers";

// P145 B2 (verdict 16, decision 0054): `notion.bug-reports` creates the database beside Clients once, lists it in project.md, and
// on a second run changes nothing; on a listed database it adds only what is missing.
const CLIENTS = "11111111-1111-4111-8111-111111111111";
const NEW_DB = "22222222-2222-4222-8222-222222222222";

function setup(listed: string | null) {
  const f = fake();
  mkdirSync(f.ctx.configDir, { recursive: true });
  writeFileSync(path.join(f.ctx.configDir, "notion-token"), "secret", { mode: 0o600 });
  const folder = mkdtempSync(path.join(tmpdir(), "hub-bug-"));
  writeFileSync(path.join(folder, "project.md"), `# P\n\n## Notion databases\n\n- clients: ${CLIENTS}\n${listed ? `- bug-reports: ${listed}\n` : ""}`);
  const project: BugProject = { slug: "p", folder, parsed: { config: { brands: [{ name: "Shop One" }], notion: { tokenFile: "notion-token", databases: [{ slug: "clients", dataSourceId: CLIENTS }, ...(listed ? [{ slug: "bug-reports", dataSourceId: listed }] : [])] } } } };
  const seen: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
  const live: Record<string, unknown> = {};
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    seen.push({ method: init.method ?? "GET", url: u, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    if (u.endsWith(`/data_sources/${CLIENTS}`)) return Response.json({ parent: { type: "database_id", database_id: "db-clients" } });
    if (u.endsWith("/databases/db-clients")) return Response.json({ parent: { type: "page_id", page_id: "page-crm" } });
    if (u.endsWith("/databases") && init.method === "POST") return Response.json({ data_sources: [{ id: NEW_DB }] });
    return Response.json({ properties: live });
  }) as unknown as typeof fetch;
  return { ctx: { ...f.ctx, fetch: fetcher }, project, seen, live, folder };
}

describe("notion.bug-reports", () => {
  it("creates it under Clients' page with a one-way Clients relation, then the self relation, then lists it in project.md", async () => {
    const s = setup(null);
    const rows = await bugReportsRows(s.ctx, [s.project]);
    expect(rows[0]?.state).toBe("absent");
    expect(await applyBugReports(s.ctx, rows)).toBe(`p: created Bug reports (${NEW_DB}) beside Clients and listed it in project.md`);
    const post = s.seen.find((x) => x.method === "POST")!;
    expect(post.body?.["parent"]).toEqual({ type: "page_id", page_id: "page-crm" });
    const props = (post.body?.["initial_data_source"] as { properties: Record<string, Record<string, unknown>> }).properties;
    expect(props["Clients"]).toMatchObject({ relation: { data_source_id: CLIENTS, type: "single_property" } });
    expect(props["Projects"]).toMatchObject({ multi_select: { options: [{ name: "Shop One" }] } });
    expect(props["Duplicate of"]).toBeUndefined();
    expect(Object.keys(props)).not.toContain("Cause");
    const patch = s.seen.find((x) => x.method === "PATCH")!;
    expect(patch.url.endsWith(NEW_DB)).toBe(true);
    expect(patch.body).toMatchObject({ properties: { "Duplicate of": { relation: { data_source_id: NEW_DB } } } });
    expect(readFileSync(path.join(s.folder, "project.md"), "utf8")).toContain(`- bug-reports: ${NEW_DB}`);
  });

  it("a listed, complete database changes nothing; a missing option is added with the live ones kept", async () => {
    const s = setup(NEW_DB);
    const pack = bugReportsPack(s.ctx.paths.notionPack);
    const full: Record<string, unknown> = {};
    for (const [name, p] of Object.entries(pack)) {
      const type = p.type === "text" ? "rich_text" : p.type;
      full[name] = { type, ...(type === "select" ? { select: { options: (p.options ?? []).map((n) => ({ name: n })) } } : {}), ...(type === "relation" ? { relation: { data_source_id: p.target === "bug-reports" ? NEW_DB : CLIENTS } } : {}) };
    }
    Object.assign(s.live, full);
    const rows = await bugReportsRows(s.ctx, [s.project]);
    expect(rows[0]?.state).toBe("ok");
    expect(await applyBugReports(s.ctx, rows)).toBe("nothing to do");
    expect(s.seen.filter((x) => x.method !== "GET")).toEqual([]);
    const gaps = bugReportsGaps(pack, { ...full, Status: { type: "select", select: { options: [{ id: "s1", name: "New" }] } } } as never, { clients: CLIENTS, self: NEW_DB });
    expect(gaps.add["Status"]).toEqual({ select: { options: [{ id: "s1", name: "New" }, ...["Triaged", "In progress", "Fixed", "Won't fix", "Duplicate"].map((name) => ({ name }))] } });
  });
});
