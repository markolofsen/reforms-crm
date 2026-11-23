import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle, Repos } from "@hub/db";
import { indexProject } from "../src/indexer";
import { knowledgeGet, knowledgeSearch, KnowledgeError, type GetResult, type SearchArgs, type SearchResult } from "../src/search";
import { cleanup, copyRoot, openRegistered } from "./helpers";

let handle: DbHandle;
let repos: Repos;
beforeEach(async () => {
  const root = copyRoot();
  ({ handle, repos } = await openRegistered(root));
  await indexProject(repos, root, "acme-travel");
  await indexProject(repos, root, "belyi-parus");
});
afterEach(() => {
  handle.close();
  cleanup();
});

// The tool contract of doc 16 section 5 as plain functions (P129 A4: the tools are `hub mcp`'s now, bound to the session's
// project; their MCP side is tested in @hub/agent's knowledge-tools test). `call` answers like a tool: the value, or the refusal.
/** A knowledge tool's answer as these tests read it: the search results, or the read document, or the refusal; the rest by key. */
type Reply = SearchResult & GetResult & { error?: string; message?: string };
async function connect(env: { hubProject?: string | undefined; today?: string }) {
  const e = { today: "2026-11-14", ...env };
  const call = async (name: string, args: Record<string, unknown>) => {
    try {
      const json = (name === "knowledge_search" ? await knowledgeSearch(repos, args as unknown as SearchArgs, e) : await knowledgeGet(repos, args as { project: string; path: string }, e)) as Reply;
      return { isError: false, json, structured: json };
    } catch (err) {
      if (err instanceof KnowledgeError) return { isError: true, json: { error: err.code, message: err.message } as Partial<Reply> as Reply, structured: undefined };
      throw err;
    }
  };
  return { call };
}

describe("knowledge_search", () => {
  it("returns the contract fields", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    const r = await call("knowledge_search", { project: "acme-travel", query: "can I cancel my booking" });
    expect(r.isError).toBe(false);
    expect(Object.keys(r.json).sort()).toEqual(["project", "query", "results", "total", "truncated"]);
    expect(r.json.project).toBe("acme-travel");
    expect(r.json.results[0]).toMatchObject({ path: "knowledge/files/terms/cancel.md", title: "Cancellation policy", use: "STATE", approved: true, expired: false, audiences: ["ANY"], category: "TERMS", valid_until: null });
    expect(Object.keys(r.json.results[0] ?? {}).sort()).toEqual(["approved", "audiences", "brands", "category", "expired", "path", "score", "snippet", "title", "use", "valid_until"]);
    expect(r.json.results[0]?.snippet.length).toBeLessThanOrEqual(400);
  });

  it("limits to 5 by default, honours limit, and flags truncation", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    const many = await call("knowledge_search", { project: "acme-travel", query: "the and of to in for you can" });
    expect(many.json.results.length).toBeLessThanOrEqual(5);
    expect(many.json.total).toBeGreaterThan(5);
    expect(many.json.truncated).toBe(true);
    const two = await call("knowledge_search", { project: "acme-travel", query: "the and of to in for you can", limit: 2 });
    expect(two.json.results).toHaveLength(2);
  });

  it("project_mismatch when HUB_PROJECT and the argument differ", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    const r = await call("knowledge_search", { project: "belyi-parus", query: "залог" });
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe("project_mismatch");
    const g = await call("knowledge_get", { project: "belyi-parus", path: "knowledge/files/terms/deposit.md" });
    expect(g.json.error).toBe("project_mismatch");
  });

  it("without HUB_PROJECT any registered project may be named; an unknown one is unknown_project", async () => {
    const { call } = await connect({ hubProject: undefined });
    expect((await call("knowledge_search", { project: "belyi-parus", query: "залог" })).isError).toBe(false);
    const r = await call("knowledge_search", { project: "nope", query: "x" });
    expect(r.json.error).toBe("unknown_project");
  });

  it("empty_query for blank text and for text with no word", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    expect((await call("knowledge_search", { project: "acme-travel", query: "   " })).json.error).toBe("empty_query");
    expect((await call("knowledge_search", { project: "acme-travel", query: '" * ' })).json.error).toBe("empty_query");
  });

  it("excludes unapproved and expired by default and flags them with include=all", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    const def = await call("knowledge_search", { project: "acme-travel", query: "loyalty programme spring sale" });
    expect(def.json.results.map((x: { path: string }) => x.path)).toEqual([]);
    const all = await call("knowledge_search", { project: "acme-travel", query: "loyalty programme spring sale", include: "all" });
    const by = Object.fromEntries(all.json.results.map((x) => [x.path, x]));
    expect(by["knowledge/files/services/loyalty.md"]).toMatchObject({ approved: false, expired: false });
    expect(by["knowledge/files/prices/springsale.md"]).toMatchObject({ approved: true, expired: true, valid_until: "2025-05-31" });
  });

  it("marks a MARKER entry as context, still returned", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    const r = await call("knowledge_search", { project: "acme-travel", query: "founder Lisbon airline planners" });
    expect(r.json.results[0]).toMatchObject({ path: "knowledge/files/about/founder.md", use: "MARKER" });
  });

  it("audience filter: listed audience or ANY; an entry with empty audiences is visible to no filtered search", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    // every acme entry lists ANY: a LAWYER search still finds them
    expect((await call("knowledge_search", { project: "acme-travel", query: "cancel", audience: "LAWYER" })).json.total).toBeGreaterThan(0);
    // an entry with no audience is only visible unfiltered
    const { createRepos } = await import("@hub/db");
    void createRepos;
    await repos.knowledge.upsert("acme-travel", { path: "knowledge/files/none.md", title: "Quokka policy", use: "STATE", approved: true, audiences: [], body: "quokka", phrasings: "", frontMatter: { title: "Quokka policy" }, contentHash: "q" });
    await repos.knowledge.upsert("acme-travel", { path: "knowledge/files/client.md", title: "Quokka clients", use: "STATE", approved: true, audiences: ["CLIENT"], body: "quokka", phrasings: "", frontMatter: { title: "Quokka clients" }, contentHash: "c" });
    const unfiltered = await call("knowledge_search", { project: "acme-travel", query: "quokka" });
    expect(unfiltered.json.total).toBe(2);
    const client = await call("knowledge_search", { project: "acme-travel", query: "quokka", audience: "CLIENT" });
    expect(client.json.results.map((x) => x.path)).toEqual(["knowledge/files/client.md"]);
    const lead = await call("knowledge_search", { project: "acme-travel", query: "quokka", audience: "LEAD" });
    expect(lead.json.total).toBe(0);
  });

  it("never returns the other project's entries", async () => {
    const { call } = await connect({ hubProject: undefined });
    const ru = await call("knowledge_search", { project: "acme-travel", query: "залог за яхту" });
    expect(ru.json.total).toBe(0);
    const en = await call("knowledge_search", { project: "belyi-parus", query: "cancellation policy" });
    expect(en.json.total).toBe(0);
  });
});

describe("knowledge_get", () => {
  it("returns the front matter and the body", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    const r = await call("knowledge_get", { project: "acme-travel", path: "knowledge/files/terms/deposit.md" });
    expect(r.isError).toBe(false);
    expect(r.json.path).toBe("knowledge/files/terms/deposit.md");
    expect(r.json.front_matter).toMatchObject({ title: "Deposit to reserve a trip", approved: true, use: "STATE" });
    expect(r.json.body).toContain("20 percent");
    expect(r.json.truncated).toBe(false);
  });

  it("not_found for a path that is not in this project", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    expect((await call("knowledge_get", { project: "acme-travel", path: "knowledge/files/nope.md" })).json.error).toBe("not_found");
    expect((await call("knowledge_get", { project: "acme-travel", path: "../../etc/passwd" })).json.error).toBe("not_found");
  });

  it("caps the body at 12000 characters", async () => {
    const { call } = await connect({ hubProject: "acme-travel" });
    await repos.knowledge.upsert("acme-travel", { path: "knowledge/files/long.md", title: "Long", use: "STATE", approved: true, audiences: ["ANY"], body: "word ".repeat(4000), phrasings: "", frontMatter: { title: "Long" }, contentHash: "l" });
    const r = await call("knowledge_get", { project: "acme-travel", path: "knowledge/files/long.md" });
    expect(r.json.body).toHaveLength(12000);
    expect(r.json.truncated).toBe(true);
  });
});
