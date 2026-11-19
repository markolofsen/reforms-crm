import { describe, expect, it } from "vitest";
import { knowledgeListDto } from "@hub/contract/knowledge";
import type { Repos } from "@hub/db";
import { createApp } from "./app";

// P70 S2: `GET /api/projects/:slug/knowledge` lists the index of the project only, with a status per entry on the project's day.
const doc = (path: string, title: string, o: Record<string, unknown> = {}) => ({ id: 1, project: "acme", path, title, use: "STATE", approved: true, audiences: '["client"]', brands: "[]", category: null, kind: null, validUntil: null, body: "the body stays on the server", phrasings: "", frontMatter: "{}", contentHash: "h", updatedAt: "", ...o });
const docs = [
  doc("knowledge/pricing.md", "Pricing", { validUntil: "2026-11-18" }),
  doc("knowledge/about.md", "About us"),
  doc("knowledge/draft.md", "Draft offer", { approved: false }),
  doc("knowledge/soon.md", "Winter terms", { validUntil: "2026-11-25" }),
  doc("knowledge/nobody.md", "Internal note", { audiences: "[]" }),
];
const settings = JSON.stringify({ schema: 1, slug: "acme", kind: "saas", name: "Acme", timezone: "Europe/Lisbon" });
const asked: string[] = [];
const repos = {
  projects: { get: async (s: string) => (s === "acme" ? { slug: "acme", settingsJson: settings } : null) },
  knowledge: { list: async (p: string) => (asked.push(p), p === "acme" ? docs : []) },
} as unknown as Repos;
const app = createApp(repos, { now: () => new Date("2026-11-19T12:00:00.000Z") });
const get = async (q = "") => {
  const res = await app.request(`http://127.0.0.1:4317/api/projects/acme/knowledge${q}`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toContain("the body stays on the server");
  return knowledgeListDto.parse(JSON.parse(text));
};

describe("GET /api/projects/:slug/knowledge", () => {
  it("lists every entry by title with its Open key and status, and counts every view", async () => {
    const d = await get();
    expect(asked.every((p) => p === "acme")).toBe(true);
    expect(d.entries.map((e) => [e.title, e.status])).toEqual([["About us", "approved"], ["Draft offer", "unapproved"], ["Internal note", "approved"], ["Pricing", "expired"], ["Winter terms", "expiring"]]);
    expect(d.entries[0]?.key).toBe("knowledge:knowledge/about.md");
    expect(d.counts).toEqual({ all: 5, attention: 4, expired: 1, unapproved: 1 });
    expect(d).toMatchObject({ scope: "shared", truncated: false });
  });

  it("filters by view and by title on the server; a bad view is all; an unknown project is 404", async () => {
    expect((await get("?filter=expired")).entries.map((e) => e.title)).toEqual(["Pricing"]);
    expect((await get("?filter=attention")).entries.map((e) => e.title)).toEqual(["Draft offer", "Internal note", "Pricing", "Winter terms"]);
    const s = await get("?q=PRIC");
    expect(s.entries.map((e) => e.title)).toEqual(["Pricing"]);
    expect(s.counts.all).toBe(1);
    expect((await get("?filter=nope")).entries).toHaveLength(5);
    expect((await app.request("http://127.0.0.1:4317/api/projects/nope/knowledge")).status).toBe(404);
  });
});
