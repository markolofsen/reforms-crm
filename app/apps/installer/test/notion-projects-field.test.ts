import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addProjectOptions, projectFieldPatch, projectFieldPlan, projectFieldRows, projectKeyVerdict, type KeyProject } from "../src/notion-projects-field";
import { fake } from "./helpers";

// P145 K3 (verdict 6, decision 0053): `notion.projects` adds an option for every `## Brands` row whose key no option has, on
// Clients.Projects, Leads.Brand and the other listed databases' Projects; it creates Clients `Projects` when missing and never
// removes, renames or recolours an option. `notion.project-keys` is the doctor's reading of the same rows.
const brands = [{ name: "Shop One" }, { name: "GPT-Like" }];
const project = (dbs: Array<[string, string]>): KeyProject => ({ slug: "p", parsed: { config: { brands, notion: { tokenFile: "notion-token", databases: dbs.map(([slug, dataSourceId]) => ({ slug, dataSourceId })) } } } });
const ms = (...names: string[]) => ({ type: "multi_select", multi_select: { options: names.map((name, i) => ({ id: `o${i}`, name, color: "blue" })) } });

function withNotion(props: Record<string, Record<string, unknown>>) {
  const f = fake();
  mkdirSync(f.ctx.configDir, { recursive: true });
  writeFileSync(path.join(f.ctx.configDir, "notion-token"), "secret", { mode: 0o600 });
  const seen: Array<{ method: string; url: string; body: unknown }> = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    seen.push({ method: init.method ?? "GET", url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ properties: props[String(url).split("/").pop() ?? ""] ?? {} }), { status: 200 });
  }) as unknown as typeof fetch;
  return { ctx: { ...f.ctx, fetch: fetcher }, seen };
}

describe("notion.projects", () => {
  it("plans the brands with no option of their key and keeps the options no brand claims", () => {
    const plan = projectFieldPlan(brands, ms("shop-one", "Foreign Site", "Other"));
    expect(plan.add).toEqual(["GPT-Like"]);
    expect(plan.unclaimed).toEqual(["Foreign Site"]);
    expect(projectFieldPatch({ property: "Brand", state: "missing", add: plan.add, options: plan.options })).toEqual({
      Brand: { multi_select: { options: [{ id: "o0", name: "shop-one", color: "blue" }, { id: "o1", name: "Foreign Site", color: "blue" }, { id: "o2", name: "Other", color: "blue" }, { name: "GPT-Like" }] } },
    });
  });

  it("creates a missing Clients Projects and adds Leads options; a missing Projects elsewhere is reported, not created", async () => {
    const { ctx, seen } = withNotion({ c: { Name: { type: "title" } }, l: { Brand: ms("Shop One") }, d: { Brand: ms("Shop One") } });
    const rows = await projectFieldRows(ctx, [project([["clients", "c"], ["leads", "l"], ["business-contacts", "d"]])]);
    expect(rows.map((r) => `${r.database}:${r.state}`)).toEqual(["clients:no_property", "leads:missing", "business-contacts:wrong_type"]);
    expect(await addProjectOptions(ctx, rows)).toBe("added p clients.Projects (created, +Shop One, +GPT-Like); p leads.Brand (+GPT-Like)");
    const patches = seen.filter((s) => s.method === "PATCH");
    expect(patches.map((p) => p.url.split("/").pop())).toEqual(["c", "l"]);
    expect(JSON.stringify(patches)).not.toMatch(/"Brand":\{"multi_select":\{"options":\[\{"name"/);
    expect(seen.some((s) => s.method === "DELETE")).toBe(false);
  });

  it("the doctor fails on a brand with no option or two, warns on an unclaimed option and a missing Project signals", async () => {
    const { ctx } = withNotion({ c: { Projects: ms("Shop One", "GPT-Like", "Foreign") }, l: { Brand: ms("Shop One", "shop-one", "GPT-Like") } });
    const rows = await projectFieldRows(ctx, [project([["clients", "c"], ["leads", "l"]])]);
    const v = projectKeyVerdict(rows);
    expect(v.level).toBe("fail");
    expect(v.detail).toContain("Shop One->shopone->Shop One+shop-one");
    expect(v.detail).toContain('no "Project signals" formula');
    const ok = projectKeyVerdict(await projectFieldRows(withNotion({ c: { Projects: ms("Shop One", "GPT-Like", "Foreign"), "Project signals": { type: "formula" } } }).ctx, [project([["clients", "c"]])]));
    expect(ok.level).toBe("warn");
    expect(ok.detail).toContain("no brand row: Foreign");
  });
});
