import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEAD_PASS_HUB_TOOLS } from "@hub/config/lead-pass";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { createHubMcpServer } from "../src/mcp/server";
import type { HubMcpEnv } from "../src/mcp/ports";
import { HTTP_RETRY_AFTER_S, HTTP_TOOL_LIMIT_MS, slowServerText } from "../src/mcp/define";
import { httpChatSort } from "../src/messenger/chat-sort-port";
import { leadPageEnvOf, attendedSession } from "../src/mcp/stdio";
import { leadSiteHosts } from "../src/mcp/tools/link";

// P147 L2 (decision 0055): the lead pass's tools, a lead turn's binding (D2), client_create's refusal of a lead (D5) and the one
// time limit of the HTTP-backed tools (verdict 10). Shape refusals only: the decision itself is never judged.

const A = "a".repeat(32);
const B = "b".repeat(32);
let dir: string;
let h: DbHandle;
let repos: Repos;
let ann: number;
beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-lead-pass-"));
  h = openDb(path.join(dir, "app.db"));
  repos = createRepos(h.db);
  ann = await repos.clients.create({ project: "acme", email: "ann@example.test", name: "Ann" });
  await repos.clients.create({ project: "acme", email: "zed@example.test", name: "Zed" });
  const at = new Date();
  const received = new Date(at.getTime() - 86_400_000).toISOString();
  await repos.leadRows.sync(
    [
      { project: "acme", pageId: A, name: "Ann Corp", email: "ann@example.test", accountEmail: null, brand: "Acme", receivedAt: received, preview: "We need the API", notionStatus: "New", hasClient: true },
      { project: "acme", pageId: B, name: "New Person", email: "new@example.test", accountEmail: null, brand: "Acme", receivedAt: received, preview: "Price?", notionStatus: "New", hasClient: false },
    ],
    at,
  );
  // The turn's pass (`leadPass: 1` below): a decision names its pass row.
  await repos.leadPass.startPass("acme", "button", at.toISOString());
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

async function connect(env: Partial<HubMcpEnv> = {}) {
  const server = createHubMcpServer(repos, { hubProject: "acme", focusFile: path.join(dir, "focus.json"), withRepos: (fn) => fn(repos), ...env });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, json: JSON.parse((r.content as Array<{ text: string }>)[0]!.text) as Record<string, unknown> };
  };
  return { client, call };
}

describe("a lead turn's hub mcp (verdict 5)", () => {
  it("registers exactly its eight lead-bound tools, none that sends", async () => {
    const { client } = await connect({ leadPage: A, leadPass: 1 });
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...LEAD_PASS_HUB_TOOLS].sort());
  });

  it("HUB_LEAD_PAGE makes the process unattended; a malformed id binds to no lead", () => {
    expect(attendedSession({ HUB_LEAD_PAGE: A })).toBe(false);
    expect(leadPageEnvOf({ HUB_LEAD_PAGE: "not-a-page" })).toBe("0".repeat(32));
    expect(leadPageEnvOf({ HUB_LEAD_PAGE: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA".replace(/-/g, "") })).toBe(A);
  });

  it("lead_decide refuses another lead and a client the address does not match exactly; client_show reads only the matched client", async () => {
    const { call } = await connect({ leadPage: B, leadPass: 1 });
    expect((await call("lead_decide", { lead: A, decision: "reply", reason: "a prospect" })).json.error).toBe("lead_other");
    expect((await call("lead_decide", { lead: B, decision: "client", reason: "looks like Ann" })).json.error).toBe("invalid");
    expect((await call("client_show", { id: ann })).json.error).toBe("lead_other");
    const r = await call("lead_decide", { lead: B, decision: "hand_over", reason: "possible match: Ann Corp" });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ decision: "hand_over", next: "Stop here: the decision is recorded. Write nothing else." });
    // F2 of 3d: changed until the owner applied it, then refused.
    expect((await call("lead_decide", { lead: B, decision: "spam", reason: "again, a test form" })).json).toMatchObject({ decision: "spam", changed: "hand_over" });
    await repos.leadRows.dismiss("acme", B, "spam");
    expect((await call("lead_decide", { lead: B, decision: "not_now", reason: "again" })).json.error).toBe("lead_decided");
  });

  it("a client decision on an exact address keeps the matched client (D3)", async () => {
    const { call } = await connect({ leadPage: A, leadPass: 1 });
    expect((await call("client_show", { id: ann })).isError).toBe(false);
    const r = await call("lead_decide", { lead: A, decision: "client", reason: "Ann Corp is a client with a non-Lead card" });
    expect(r.json).toMatchObject({ decision: "client", client: ann });
    expect((await repos.leadRows.get("acme", A))?.passClientId).toBe(ann);
  });

  it("draft_write in a lead turn writes only a new thread to the lead's reply address", async () => {
    const { call } = await connect({ leadPage: B, leadPass: 1 });
    expect((await call("draft_write", { kind: "reply", message: { inbound: 1 }, content: "Hi" })).json.error).toBe("lead_other");
    expect((await call("draft_write", { kind: "new", to: "other@example.test", subject: "Hi", content: "Hi", owner_request: "x" })).json.error).toBe("address_not_on_lead");
    expect((await call("draft_write", { kind: "new", lead: A, subject: "Hi", content: "Hi" })).json.error).toBe("lead_other");
  });

  it("E2: an attended draft_write with lead takes its address from the row and refuses any other to", async () => {
    const { call } = await connect();
    const r = await call("draft_write", { kind: "new", lead: B, to: "someone@gmail.example", subject: "Hi", content: "Hi", owner_request: "x" });
    expect(r.json.error).toBe("address_not_on_lead");
    expect(String(r.json.message)).toContain("new@example.test");
  });
});

describe("3e S5: a lead turn reads only the lead's own site", () => {
  it("the hosts are the form's Site and a non-free-mail reply domain", () => {
    expect(leadSiteHosts({ site: "https://www.kodacar.example/about", email: "ann@gmail.com", accountEmail: null })).toEqual(["kodacar.example"]);
    expect(leadSiteHosts({ site: null, email: "ann@corp.example", accountEmail: null })).toEqual(["corp.example"]);
    expect(leadSiteHosts({ site: null, email: "ann@gmail.com", accountEmail: null })).toEqual([]);
  });

  it("link_fetch refuses another host and opens the lead's own", async () => {
    const seen: string[] = [];
    const linkFetch = async (u: string) => (seen.push(u), { url: u, status: 200, contentType: "text/html", body: Buffer.from("<title>Corp</title><p>We sell cars</p>"), cut: false });
    const { call } = await connect({ leadPage: B, leadPass: 1, linkFetch: linkFetch as never });
    await repos.leadRows.sync([{ project: "acme", pageId: B, name: "New Person", email: "new@corp.example", accountEmail: null, brand: "Acme", receivedAt: new Date().toISOString(), preview: "Price?", notionStatus: "New", hasClient: false }], new Date());
    expect((await call("link_fetch", { url: "https://evil.example/x" })).json.error).toBe("link_refused");
    expect((await call("link_fetch", { url: "https://www.corp.example/about" })).isError).toBe(false);
    expect(seen).toEqual(["https://www.corp.example/about"]);
  });
});

describe("the attended pass", () => {
  it("F1: client answered in a channel needs that client's live conversation there, and no draft is asked for", async () => {
    const { call } = await connect();
    const none = await call("lead_decide", { lead: B, decision: "client", reason: "answered in whatsapp", client: ann, answered_in: "whatsapp" });
    expect(none.json.error).toBe("invalid");
    await repos.messengers.addIdentifier("acme", ann, "whatsapp", "4915112345678");
    const r = await call("lead_decide", { lead: B, decision: "client", reason: "answered in whatsapp", client: ann, answered_in: "whatsapp" });
    expect(r.json).toMatchObject({ decision: "client", client: ann, hint: null });
    expect((await repos.leadRows.get("acme", B))?.passClientId).toBe(ann);
  });

  it("F3: lead_pass_start starts the server pass through its port; without one it is unavailable", async () => {
    const runs: string[] = [];
    const { call } = await connect({ leadPassRun: { run: async (slug) => (runs.push(slug), { ok: true, joined: false }) } });
    expect((await call("lead_pass_start", {})).json).toMatchObject({ started: true, joined: false });
    expect(runs).toEqual(["acme"]);
    expect((await (await connect()).call("lead_pass_start", {})).json.error).toBe("unavailable");
  });

  it("leads_open lists the open leads with no decision; an attended decision is one dock pass row", async () => {
    const { call } = await connect({ projectConfig: () => ({ leads: { windowDays: 14 } }) as never });
    const open = await call("leads_open", {});
    expect((open.json.leads as Array<{ page: string; client: number | null }>).map((l) => [l.page, l.client])).toEqual(expect.arrayContaining([[A, ann], [B, null]]));
    await call("lead_decide", { lead: B, decision: "not_now", reason: "a student project" });
    expect((await call("leads_open", {})).json.leads).toHaveLength(1);
    expect((await repos.leadPass.lastPass("acme"))).toMatchObject({ trigger: "dock", notNow: 1 });
  });

  it("client_create refuses the reply address of a lead not yet converted (D5)", async () => {
    // An attended session (the owner's: it has the agent send door); an unattended one is refused before this read.
    const { call } = await connect({ agentSend: (async () => ({ ok: false, reason: "refused", error: "test", next: "test" })) as never });
    const r = await call("client_create", { name: "New Person", email: "new@example.test" });
    expect(r.json.error).toBe("is_lead");
  });
});

describe("a slow server answers fast (verdict 10)", () => {
  it("one limit: 10 s for reads, 150 s for creates; a timeout is unavailable with retry_after_s", async () => {
    expect(HTTP_TOOL_LIMIT_MS).toMatchObject({ read: 10_000, create: 150_000 });
    const seen: number[] = [];
    const slow: typeof fetch = async (_url, init) => {
      seen.push(init?.signal ? 1 : 0);
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    };
    const port = httpChatSort({ port: () => 4999, token: () => "t", fetch: slow });
    const a = await port.unlinked("acme");
    expect(a).toEqual({ ok: false, status: 0, error: slowServerText(10_000) });
    expect(seen).toEqual([1]);
    const { call } = await connect({ chatSort: port });
    const r = await call("chats_unlinked", {});
    expect(r.json).toMatchObject({ error: "unavailable", retry_after_s: HTTP_RETRY_AFTER_S });
    expect(String(r.json.message)).toContain("did not answer in 10 s");
  });
});
