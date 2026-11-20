import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, openDbReadOnly, type DbHandle, type Repos } from "@hub/db";
import { SEND_LIKE_TOOL } from "../src/deny";
import { focusLine, readFocus } from "../src/focus";
import { createHubMcpServer, HUB_MCP_TOOLS } from "../src/mcp";

// The shared focus reader and the hub MCP server (P51 F1, F2), on a throwaway database: no CLI, no Mail.

let dir: string;
let file: string;
let rw: DbHandle;
let ro: DbHandle;
let repos: Repos;
const NOW = new Date("2026-11-18T10:00:30Z");
const ids = { mark: 0, ann: 0, other: 0 };

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-focus-reader-"));
  file = path.join(dir, "focus.json");
  rw = openDb(path.join(dir, "app.db"));
  const w = createRepos(rw.db);
  ids.mark = (await w.drafts.record({ project: "acme", email: "mark@example.com", name: "Mark Effect", subject: `Re: Hello ${"x".repeat(200)}`, mailRef: "<m1@example.com>", excerpt: "I'm well" })).draftId;
  ids.ann = (await w.drafts.record({ project: "acme", email: "ann@example.com", name: "Ann", subject: "Re: Price", mailRef: "<m2@example.com>" })).draftId;
  ids.other = (await w.drafts.record({ project: "beta", email: "zed@example.com", name: "Zed Secret", subject: "Re: Beta only", mailRef: "<m3@example.com>" })).draftId;
  ro = openDbReadOnly(path.join(dir, "app.db"));
  repos = createRepos(ro.db);
});
afterEach(() => {
  ro.close();
  rw.close();
  rmSync(dir, { recursive: true, force: true });
});

const put = (focus: Record<string, unknown>, at = "2026-11-18T10:00:00.000Z") => writeFileSync(file, JSON.stringify({ schema: 1, at, focus: { tab: "t1", project: "acme", screen: "draft", selected: [], visible: true, ...focus } }));
const read = (slug = "acme", now = NOW) => readFocus({ file, slug, repos, now });

describe("readFocus", () => {
  it("fresh: the draft, its client and the line the hook adds", async () => {
    put({ draftId: ids.mark, view: "ready" });
    const f = await read();
    expect(f).toMatchObject({ state: "fresh", ageSeconds: 30, screen: "draft", draft: { id: ids.mark, status: "ready", mailRef: "<m1@example.com>", client: { name: "Mark Effect", email: "mark@example.com" } } });
    expect(f.draft?.subject.length).toBeLessThanOrEqual(120);
    expect(focusLine(f)).toMatch(new RegExp(`^\\[Hub focus, data\\] draft ${ids.mark} · Mark Effect <mark@example.com> · Re: Hello x+… · ready · 30 s ago`));
  });

  it("stale by age (over 10 minutes) and by a hidden tab: no line", async () => {
    put({ draftId: ids.mark });
    const old = await read("acme", new Date("2026-11-18T10:11:00Z"));
    expect(old.state).toBe("stale");
    expect(focusLine(old)).toBeNull();
    put({ draftId: ids.mark, visible: false });
    expect((await read()).state).toBe("stale");
  });

  it("elsewhere names nothing of the other project", async () => {
    put({ project: "beta", draftId: ids.other });
    const f = await read();
    expect(f).toMatchObject({ state: "elsewhere", draft: null, client: null, selected: [] });
    expect(JSON.stringify(f)).not.toMatch(/Zed|Beta only|beta/);
    expect(focusLine(f)).toMatch(/another project/);
  });

  it("an id of another project, or a deleted one, drops out of the draft and the selection", async () => {
    put({ screen: "drafts", draftId: ids.other, selected: [ids.ann, ids.other, 9999] });
    const f = await read();
    expect(f.draft).toBeNull();
    expect(f.selected.map((s) => s.id)).toEqual([ids.ann]);
    expect(f.selectedMore).toBe(2);
    expect(JSON.stringify(f)).not.toMatch(/Zed/);
  });

  it("none: no file, a broken file, no bound project", async () => {
    expect((await read()).state).toBe("none");
    writeFileSync(file, "{not json");
    expect((await read()).state).toBe("none");
    put({ draftId: ids.mark });
    expect((await readFocus({ file, slug: undefined, repos, now: NOW })).state).toBe("none");
  });
});

async function connect(hubProject: string | undefined) {
  const server = createHubMcpServer(repos, { hubProject, focusFile: file, now: () => NOW });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    return { isError: res.isError === true, json: JSON.parse(text) as Record<string, any> };
  };
  return { client, call };
}

describe("hub mcp", () => {
  it("lists exactly the eight tools: six read-only (mail_brand reads no Mail), draft_write the one Mail write, messenger_draft_write the one messenger write (P71); none send-like", async () => {
    const { client } = await connect("acme");
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...HUB_MCP_TOOLS].sort());
    expect(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name).sort()).toEqual(["draft_write", "messenger_draft_write"]);
    expect(tools.filter((t) => SEND_LIKE_TOOL.test(t.name))).toEqual([]);
  });

  it("focus and draft_show: the draft without a body field; another project's draft is refused", async () => {
    put({ draftId: ids.mark });
    const { call } = await connect("acme");
    expect((await call("focus")).json).toMatchObject({ state: "fresh", draft: { id: ids.mark } });
    const d = await call("draft_show", { id: ids.mark });
    expect(d.isError).toBe(false);
    expect(d.json).toMatchObject({ id: ids.mark, mailRef: "<m1@example.com>", to: "mark@example.com", excerpt: "I'm well", client: { email: "mark@example.com" } });
    expect(d.json.body).toMatch(/^In Mail, not here/);
    expect(d.json.activity.length).toBeGreaterThan(0);
    const other = await call("draft_show", { id: ids.other });
    expect(other).toMatchObject({ isError: true, json: { error: "not_found" } });
  });

  it("client_show by id and by email, drafts_list for a view; unbound refuses", async () => {
    const { call } = await connect("acme");
    const byEmail = await call("client_show", { email: "ann@example.com" });
    expect(byEmail.json).toMatchObject({ name: "Ann", drafts: [{ id: ids.ann, status: "ready" }] });
    const byId = await call("client_show", { id: byEmail.json.id });
    expect(byId.json.email).toBe("ann@example.com");
    expect((await call("client_show", { email: "zed@example.com" })).isError).toBe(true);
    const list = await call("drafts_list", { view: "ready" });
    expect(list.json.drafts.map((r: { id: number }) => r.id).sort()).toEqual([ids.mark, ids.ann].sort());
    const unbound = await connect(undefined);
    expect((await unbound.call("focus")).json.error).toBe("unbound");
  });

  it("the database handle is read-only: a write throws", async () => {
    await expect(repos.drafts.setStatus(ids.mark, "hold")).rejects.toThrow(/readonly/i);
  });
});
