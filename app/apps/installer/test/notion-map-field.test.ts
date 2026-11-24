import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addMapField, mapFieldRows } from "../src/notion-map-field";
import type { NotionProject } from "../src/notion-check";
import { fake } from "./helpers";

// P135 K5: `notion.client-map` adds the date "Map updated" to each project's Clients database, one PATCH of that property only.
const project = (slug: string, tokenFile = "notion-token"): NotionProject => ({ slug, parsed: { config: { notion: { tokenFile, databases: [{ slug: "clients", dataSourceId: `ds-${slug}` }] } } } });

function withNotion(props: Record<string, Record<string, { type: string }>>) {
  const f = fake();
  writeFileSync(path.join(f.ctx.configDir, "notion-token"), "secret", { mode: 0o600 });
  const seen: Array<{ method: string; url: string; body: unknown }> = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    seen.push({ method: init.method ?? "GET", url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
    const id = String(url).split("/").pop() ?? "";
    return new Response(JSON.stringify({ properties: props[id] ?? {} }), { status: 200 });
  }) as unknown as typeof fetch;
  return { ctx: { ...f.ctx, fetch: fetcher }, seen };
}

describe("notion.client-map", () => {
  it("finds the Clients databases without the date and adds exactly that property to them", async () => {
    const { ctx, seen } = withNotion({ "ds-a": { Name: { type: "title" } }, "ds-b": { "Map updated": { type: "date" } } });
    const rows = await mapFieldRows(ctx, [project("a"), project("b")]);
    expect(rows.map((r) => `${r.slug}:${r.state}`)).toEqual(["a:missing", "b:ok"]);
    expect(await addMapField(ctx, rows)).toBe('added "Map updated" to Clients of a');
    const patches = seen.filter((s) => s.method === "PATCH");
    expect(patches).toEqual([{ method: "PATCH", url: "https://api.notion.com/v1/data_sources/ds-a", body: { properties: { "Map updated": { date: {} } } } }]);
    expect(seen.some((s) => s.method === "DELETE")).toBe(false);
  });
  it("leaves a name taken by another type and a project without a token alone", async () => {
    const { ctx, seen } = withNotion({ "ds-a": { "Map updated": { type: "rich_text" } } });
    const rows = await mapFieldRows(ctx, [project("a"), project("c", "notion-token-c")]);
    expect(rows.map((r) => r.state)).toEqual(["wrong_type", "no_token"]);
    expect(await addMapField(ctx, rows)).toBe("nothing to add");
    expect(seen.filter((s) => s.method === "PATCH")).toEqual([]);
  });
});
