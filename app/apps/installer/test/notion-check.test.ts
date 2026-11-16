import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { notionCheck, type NotionProject } from "../src/notion-check.ts";
import { fake } from "./helpers.ts";

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

  it("stops at the first 401: the token itself is wrong", async () => {
    const f = fake();
    put(f.ctx.configDir, "notion-token", TOKEN);
    const calls = withFetch(f, () => 401);
    const r = await notionCheck(f.ctx, project());
    expect(r).toMatchObject({ ok: false });
    expect(r.detail).toMatch(/rejected the token \(401\)/);
    expect(calls).toHaveLength(1);
  });
});
