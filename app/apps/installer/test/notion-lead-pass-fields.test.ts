import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addLeadPassFields, leadPassFieldRows } from "../src/notion-lead-pass-fields";
import type { NotionProject } from "../src/notion-check";
import { fake } from "./helpers";

// P147 L7: `notion.lead-pass` adds the two Hub-owned lead pass properties to each project's Leads database, one PATCH of only the
// missing ones; Status, Owner and Notes are never named.
const project = (slug: string, tokenFile = "notion-token"): NotionProject => ({ slug, parsed: { config: { notion: { tokenFile, databases: [{ slug: "leads", dataSourceId: `ds-${slug}` }] } } } });

function withNotion(props: Record<string, Record<string, { type: string }>>) {
  const f = fake();
  mkdirSync(f.ctx.configDir, { recursive: true });
  writeFileSync(path.join(f.ctx.configDir, "notion-token"), "secret", { mode: 0o600 });
  const seen: Array<{ method: string; url: string; body: unknown }> = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    seen.push({ method: init.method ?? "GET", url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
    const id = String(url).split("/").pop() ?? "";
    return new Response(JSON.stringify({ properties: props[id] ?? {} }), { status: 200 });
  }) as unknown as typeof fetch;
  return { ctx: { ...f.ctx, fetch: fetcher }, seen };
}

describe("notion.lead-pass", () => {
  it("adds exactly the missing properties, the select with the pass's decisions", async () => {
    const { ctx, seen } = withNotion({ "ds-a": { Name: { type: "title" }, Status: { type: "select" } }, "ds-b": { "Hub decision": { type: "select" }, "Hub reason": { type: "rich_text" } } });
    const rows = await leadPassFieldRows(ctx, [project("a"), project("b")]);
    expect(rows.map((r) => `${r.slug}:${r.state}`)).toEqual(["a:missing", "b:ok"]);
    expect(await addLeadPassFields(ctx, rows)).toBe("added the lead pass properties to Leads of a (2)");
    const patches = seen.filter((s) => s.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({
      properties: {
        "Hub decision": { select: { options: [{ name: "Reply" }, { name: "Client" }, { name: "Spam proposed" }, { name: "Not now proposed" }, { name: "For you" }] } },
        "Hub reason": { rich_text: {} },
      },
    });
    expect(JSON.stringify(patches)).not.toContain("Status");
  });
  it("leaves a name taken by another type and a project without a token alone", async () => {
    const { ctx, seen } = withNotion({ "ds-a": { "Hub decision": { type: "rich_text" }, "Hub reason": { type: "rich_text" } } });
    const rows = await leadPassFieldRows(ctx, [project("a"), project("c", "notion-token-c")]);
    expect(rows.map((r) => r.state)).toEqual(["wrong_type", "no_token"]);
    expect(seen.filter((s) => s.method === "PATCH")).toEqual([]);
  });
});
