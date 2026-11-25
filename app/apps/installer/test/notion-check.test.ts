import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { notionCheck, type NotionProject } from "../src/notion-check";
import { fake } from "./helpers";

const TOKEN = "ntn\u005fprojecttoken0123456789";
const project = (tokenFile = "notion-token", dbs = [{ slug: "clients", dataSourceId: "aaaa" }, { slug: "deals", dataSourceId: "bbbb" }]): NotionProject => ({
  slug: "acme",
  parsed: { config: { notion: { tokenFile, databases: dbs } } },
});
const put = (dir: string, name: string, body: string, mode = 0o600) => {
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  writeFileSync(f, body);
  chmodSync(f, mode);
};
const withFetch = (f: ReturnType<typeof fake>, answer: (url: string, init?: RequestInit) => number | Error) => {
  const calls: { url: string; method: string; auth: string }[] = [];
  f.ctx.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", auth: String((init?.headers as Record<string, string>)?.authorization) });
    const a = answer(url, init);
    if (a instanceof Error) throw a;
    return new Response("{}", { status: a });
  }) as typeof fetch;
  return calls;
};

describe("notionCheck (doctor --project)", () => {
  it("passes when every database answers 200, with only GET requests and the project's own token", async () => {
    const f = fake();
    put(f.ctx.configDir, "acme-notion-token", `${TOKEN}\n`);
    const calls = withFetch(f, () => 200);
    const r = await notionCheck(f.ctx, project("acme-notion-token"));
    expect(r).toEqual({ ok: true, detail: "2/2 readable: clients, deals" });
    expect(calls.map((c) => [c.method, c.url])).toEqual([["GET", "https://api.notion.com/v1/data_sources/aaaa"], ["GET", "https://api.notion.com/v1/data_sources/bbbb"]]);
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("uses the shared token file for the default name", async () => {
    const f = fake();
    put(f.ctx.configDir, "notion-token", TOKEN);
    const calls = withFetch(f, () => 200);
    expect((await notionCheck(f.ctx, project())).ok).toBe(true);
    expect(calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
  });

  it("a project with its own token file never falls back to the shared token", async () => {
    const f = fake();
    put(f.ctx.configDir, "notion-token", TOKEN);
    const calls = withFetch(f, () => 200);
    const r = await notionCheck(f.ctx, project("acme-notion-token"));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/acme-notion-token is missing .*never uses the shared one/);
    expect(calls).toEqual([]);
  });

  it("fails on a missing shared token, an empty file, a file others can read, and an unsafe name; no request is made", async () => {
    const f = fake();
    const calls = withFetch(f, () => 200);
    expect((await notionCheck(f.ctx, project())).detail).toMatch(/notion-token is missing \(run `pnpm hub token notion`\)/);
    put(f.ctx.configDir, "empty", "  \n");
    expect((await notionCheck(f.ctx, project("empty"))).detail).toMatch(/is empty/);
    put(f.ctx.configDir, "open", TOKEN, 0o644);
    const open = await notionCheck(f.ctx, project("open"));
    expect(open.detail).toMatch(/mode 644, must be 600/);
    expect(open.detail).not.toContain(TOKEN);
    for (const bad of ["../notion-token", "a/b", ".hidden"]) expect((await notionCheck(f.ctx, project(bad))).detail).toMatch(/not a plain file name/);
    expect((await notionCheck(f.ctx, project("notion-token", []))).detail).toMatch(/no ## Notion databases/);
    expect(calls).toEqual([]);
  });

  it("names the database that is not shared (404), the one that errors, and one that cannot be reached", async () => {
    const f = fake();
    put(f.ctx.configDir, "notion-token", TOKEN);
    const dbs = [{ slug: "a", dataSourceId: "id-a" }, { slug: "b", dataSourceId: "id-b" }, { slug: "c", dataSourceId: "id-c" }, { slug: "d", dataSourceId: "id-d" }];
    withFetch(f, (u) => (u.endsWith("id-a") ? 200 : u.endsWith("id-b") ? 404 : u.endsWith("id-c") ? 500 : new TypeError(`fetch failed ${TOKEN}`)));
    const r = await notionCheck(f.ctx, project("notion-token", dbs));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("1/4 readable");
    expect(r.detail).toContain("b: not shared with the integration (404)");
    expect(r.detail).toContain("c: Notion answered 500");
    expect(r.detail).toContain("d: cannot reach Notion (TypeError)");
    expect(r.detail).not.toContain(TOKEN);
  });

  it("when every database is a 404 it says once that the teamspace is not shared, and where to click", async () => {
    const f = fake();
    put(f.ctx.configDir, "notion-token", TOKEN);
    const proj = { slug: "acme", parsed: { config: { notion: { tokenFile: "notion-token", teamspace: "CRM: SaaS", databases: [{ slug: "a", dataSourceId: "id-a" }, { slug: "b", dataSourceId: "id-b" }] } } } };
    withFetch(f, () => 404);
    const r = await notionCheck(f.ctx, proj);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('0/2 readable; the integration sees none of teamspace "CRM: SaaS"');
    expect(r.detail).toContain("Connections > add the integration");
    expect(r.detail).not.toContain("a: not shared");
  });

  it("stops at the first 401: the token itself is wrong", async () => {
    const f = fake();
    put(f.ctx.configDir, "notion-token", TOKEN);
    const calls = withFetch(f, () => 401);
    const r = await notionCheck(f.ctx, project());
    expect(r).toMatchObject({ ok: false });
    expect(r.detail).toMatch(/rejected the token \(401\)/);
    expect(calls).toHaveLength(1);
  });

  const bodies = (f: ReturnType<typeof fake>, by: Record<string, { status?: number; body?: unknown }>) => {
    f.ctx.fetch = (async (url: string) => {
      const hit = by[url.split("/").pop()!] ?? { status: 404 };
      return new Response(JSON.stringify(hit.body ?? {}), { status: hit.status ?? 200 });
    }) as typeof fetch;
  };

  it("an archived or trashed database answers 200 but fails, with the database named and the fix", async () => {
    const f = fake();
    put(f.ctx.configDir, "notion-token", TOKEN);
    bodies(f, { aaaa: { body: { archived: true } }, bbbb: { body: { in_trash: false } } });
    const r = await notionCheck(f.ctx, project());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("clients: archived in Notion");
    expect(r.detail).not.toContain("deals:");
    bodies(f, { aaaa: { body: { in_trash: true } }, bbbb: {} });
    expect((await notionCheck(f.ctx, project())).detail).toContain("clients: archived in Notion");
  });

  it("403 means the integration cannot read it: one line naming the database and where to share it", async () => {
    const f = fake();
    put(f.ctx.configDir, "notion-token", TOKEN);
    bodies(f, { aaaa: {}, bbbb: { status: 403 } });
    const r = await notionCheck(f.ctx, project());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("deals: the integration cannot read it (403): share it with the integration under Connections");
  });

  it("a relation target that project.md does not list (Leads) must be reachable and live too; each is read once", async () => {
    const f = fake();
    put(f.ctx.configDir, "notion-token", TOKEN);
    const rel = (id: string) => ({ type: "relation", relation: { data_source_id: id } });
    const seen: string[] = [];
    const answers: Record<string, { status?: number; body?: unknown }> = {
      aaaa: { body: { properties: { Name: { type: "title" }, Leads: rel("LEAD-0000-0000-0000-0000"), Deals: rel("bbbb") } } },
      bbbb: { body: { properties: { Lead: rel("lead0000000000000000") } } },
      "LEAD-0000-0000-0000-0000": { status: 404 },
    };
    f.ctx.fetch = (async (url: string) => { seen.push(url.split("/").pop()!); const a = answers[url.split("/").pop()!] ?? { status: 404 }; return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200 }); }) as typeof fetch;
    const r = await notionCheck(f.ctx, project());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("relation target clients.Leads -> lead0000: not shared with the integration (404): share that database with the integration under Connections");
    expect(seen.filter((x) => x.toLowerCase().startsWith("lead"))).toHaveLength(1);
    answers["LEAD-0000-0000-0000-0000"] = { body: { archived: true } };
    // P145 K3 (verdict 9): an archived target project.md does not list is a legacy module the Hub never writes: a warning, not a failure.
    const legacy = await notionCheck(f.ctx, project());
    expect(legacy.ok).toBe(true);
    expect(legacy.warnings).toEqual(["relation target clients.Leads -> lead0000: archived in Notion (the Hub does not use it): relink the property to the live database, or remove it"]);
    answers["LEAD-0000-0000-0000-0000"] = {};
    const ok = await notionCheck(f.ctx, project());
    expect(ok).toEqual({ ok: true, detail: "2/2 readable: clients, deals; 1 relation target(s) reachable" });
  });
});
