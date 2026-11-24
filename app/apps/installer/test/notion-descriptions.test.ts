import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { descriptionChanges, descriptionPatch, descriptionRows, syncDescriptions } from "../src/notion-descriptions";
import type { NotionProject } from "../src/notion-check";
import { fake } from "./helpers";

// P140 P1a: `notion.descriptions` sets the pack's property descriptions on a live database, one PATCH, the select's options kept.
const DESC = "Kept current by the agent from what the client says (never invented); the owner may edit.";
const project = (slug: string): NotionProject => ({ slug, parsed: { config: { notion: { tokenFile: "notion-token", databases: [{ slug: "clients", dataSourceId: `ds-${slug}` }] } } } });

function pack(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-pack-"));
  mkdirSync(path.join(dir, "schema"));
  writeFileSync(path.join(dir, "schema", "clients.json"), JSON.stringify({ database: "clients", properties: { Name: { type: "title", description: DESC }, Relationship: { type: "select", description: DESC }, Telegram: { type: "text" } } }));
  return dir;
}

const live = {
  Name: { type: "title", description: "Filled by CRM, do not edit" },
  Relationship: { type: "select", description: "Filled by CRM, do not edit", select: { options: [{ id: "a1", name: "Lead", color: "blue" }, { id: "a2", name: "Client", color: "green" }] } },
  Telegram: { type: "rich_text", description: "Edited by people." },
};

describe("notion.descriptions", () => {
  it("finds the properties whose description differs and patches only them, with the select's own options", async () => {
    const f = fake();
    mkdirSync(f.ctx.configDir, { recursive: true });
    writeFileSync(path.join(f.ctx.configDir, "notion-token"), "secret", { mode: 0o600 });
    const seen: Array<{ method: string; body: unknown }> = [];
    const fetcher = (async (_url: string, init: RequestInit = {}) => {
      seen.push({ method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ properties: live }), { status: 200 });
    }) as unknown as typeof fetch;
    const ctx = { ...f.ctx, fetch: fetcher };
    const rows = await descriptionRows(ctx, [project("a")], pack());
    expect(rows.map((r) => `${r.slug}:${r.state}:${r.changes.map((c) => c.property).join("+")}`)).toEqual(["a:differs:Name+Relationship"]);
    expect(await syncDescriptions(ctx, rows)).toBe("set the pack's descriptions on a clients (2)");
    const patches = seen.filter((s) => s.method === "PATCH");
    expect(patches).toEqual([
      { method: "PATCH", body: { properties: { Name: { description: DESC, title: {} }, Relationship: { description: DESC, select: { options: [{ id: "a1", name: "Lead", color: "blue" }, { id: "a2", name: "Client", color: "green" }] } } } } },
    ]);
  });
  it("is clean when the live text is the pack's, and leaves a property the live database lacks alone", () => {
    expect(descriptionChanges(new Map([["Name", DESC], ["Gone", DESC]]), { Name: { type: "title", description: DESC } })).toEqual([]);
    expect(descriptionPatch([])).toEqual({ properties: {} });
  });
});
