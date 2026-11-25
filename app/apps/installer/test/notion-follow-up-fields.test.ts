import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addFollowUpFields, followUpFieldRows } from "../src/notion-follow-up-fields";
import type { NotionProject } from "../src/notion-check";
import { fake } from "./helpers";

// P142 F7 (verdict 12): `notion.follow-ups` adds the four Hub-owned follow-up properties to each project's Clients database, one
// PATCH of only the missing ones; the CRM's own fields (Follow-up on, Waiting since) are never named.
const project = (slug: string, tokenFile = "notion-token"): NotionProject => ({ slug, parsed: { config: { notion: { tokenFile, databases: [{ slug: "clients", dataSourceId: `ds-${slug}` }] } } } });

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

const ALL = { "Next follow-up": { type: "date" }, "Follow-up status": { type: "select" }, "Follow-ups sent": { type: "number" }, "Waiting on": { type: "select" } };

describe("notion.follow-ups", () => {
  it("adds exactly the missing properties, the selects with their options", async () => {
    const { ctx, seen } = withNotion({ "ds-a": { Name: { type: "title" }, "Follow-up on": { type: "date" }, "Next follow-up": { type: "date" } }, "ds-b": ALL });
    const rows = await followUpFieldRows(ctx, [project("a"), project("b")]);
    expect(rows.map((r) => `${r.slug}:${r.state}`)).toEqual(["a:missing", "b:ok"]);
    expect(await addFollowUpFields(ctx, rows)).toBe("added the follow-up properties to Clients of a (3)");
    const patches = seen.filter((s) => s.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toBe("https://api.notion.com/v1/data_sources/ds-a");
    expect(patches[0]?.body).toEqual({
      properties: {
        "Follow-up status": { select: { options: [{ name: "Waiting" }, { name: "Nudge ready" }, { name: "Stopped" }, { name: "Handed over" }, { name: "Answered" }] } },
        "Follow-ups sent": { number: { format: "number" } },
        "Waiting on": { select: { options: [{ name: "Them" }, { name: "Us" }] } },
      },
    });
    expect(JSON.stringify(patches)).not.toContain("Follow-up on");
    expect(seen.some((s) => s.method === "DELETE")).toBe(false);
  });
  it("leaves a name taken by another type and a project without a token alone, and reads only", async () => {
    const { ctx, seen } = withNotion({ "ds-a": { ...ALL, "Waiting on": { type: "rich_text" } } });
    const rows = await followUpFieldRows(ctx, [project("a"), project("c", "notion-token-c")]);
    expect(rows.map((r) => r.state)).toEqual(["wrong_type", "no_token"]);
    expect(await addFollowUpFields(ctx, rows)).toBe("nothing to add");
    expect(seen.filter((s) => s.method === "PATCH")).toEqual([]);
  });
});
