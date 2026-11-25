import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pathsAt } from "@hub/config/paths";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { claudeDisallowed, claudeSettings } from "../src/claude";
import { codexConfigToml } from "../src/codex";
import { ATTENDED_SEND_TOOLS, DENIED_TOOLS, deniedTools, deniedToolsOf, denyRules, SEND_LIKE_TOOL } from "../src/deny";
import { createHubMcpServer, HUB_MCP_ATTENDED_TOOLS, HUB_MCP_TOOLS } from "../src/mcp/server";
import { httpAgentSend, MESSENGER_SEND_TOOL, sentLine, type AgentSendPort } from "../src/messenger/send-tool";
import { AUTOPILOT_HUB_TOOLS } from "@hub/config/autopilot";
import { AUTOPILOT_ALLOWED, autopilotDisallowed } from "../src/autopilot";
import { LEAD_PASS_HUB_TOOLS } from "@hub/config/lead-pass";
import { LEAD_PASS_ALLOWED, leadPassDisallowed } from "../src/lead-pass";

// Decision 0046 (P132 B1-3): `messenger_send` exists only in a session the owner started (attended), whatever the permission
// mode (owner 2026-11-25: one mode, no prompts with the OS sandbox). In a background run it is absent from `hub mcp` and on the
// turn's deny list; in the owner's session it is the one send tool, and Mail has none.

const SEND = "mcp__hub__messenger_send";
let dir: string;
let h: DbHandle;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-deny-modes-"));
  h = openDb(path.join(dir, "app.db"));
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

async function toolsOf(agentSend?: AgentSendPort) {
  const server = createHubMcpServer(createRepos(h.db), { hubProject: "acme", focusFile: path.join(dir, "focus.json"), ...(agentSend ? { agentSend } : {}) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  return { client, names: (await client.listTools()).tools.map((t) => t.name).sort() };
}

describe("the deny list by who started the session (decision 0046)", () => {
  it("a background run denies messenger_send; the owner's session keeps every other denial and drops only that one", () => {
    expect(ATTENDED_SEND_TOOLS).toEqual([SEND]);
    expect(DENIED_TOOLS).not.toContain(SEND);
    expect(deniedTools("background")).toEqual([...DENIED_TOOLS, SEND]);
    expect(deniedTools("owner")).toEqual(DENIED_TOOLS);
    expect(deniedTools()).toContain(SEND);
    expect(deniedToolsOf("hub", "background")).toEqual(["messenger_send"]);
    expect(deniedToolsOf("hub", "owner")).toEqual([]);
    expect(claudeDisallowed([])).not.toContain(SEND);
    const paths = pathsAt(dir);
    expect(denyRules(path.join(dir, "projects"), dir, "acme", paths)).not.toContain(SEND);
    // Every Mail send door stays denied.
    for (const t of DENIED_TOOLS) expect(denyRules(path.join(dir, "projects"), dir, "acme", paths)).toContain(t);
  });

  it("the owner's session files: Claude's deny rules and Codex's config keep messenger_send, and Codex approves it by name", () => {
    const paths = pathsAt(dir);
    const deny = (claudeSettings({ paths, projectsDir: path.join(dir, "projects"), slug: "acme", nodeBin: "node" }).permissions as { deny: string[] }).deny;
    expect(deny).not.toContain(SEND);
    const toml = codexConfigToml({ paths, projectsDir: path.join(dir, "projects"), slug: "acme", servers: { hub: { type: "stdio", command: "node", args: ["hub.mjs", "mcp"] } }, instructions: "x" });
    expect(toml).not.toMatch(/disabled_tools = \[[^\]]*messenger_send/);
    expect(toml).toContain('[mcp_servers."hub".tools."messenger_send"]\napproval_mode = "approve"');
  });

  it("a config that still says agent.unattended: true with no background marker is attended (the dock, a terminal, a resumed session)", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { instanceFeatures } = await import("@hub/config/paths");
    const { attendedSession } = await import("../src/mcp/stdio");
    mkdirSync(path.join(dir, "config"), { recursive: true });
    writeFileSync(path.join(dir, "config", "config.json"), JSON.stringify({ agent: { default: "claude", unattended: true } }));
    expect(instanceFeatures(pathsAt(dir))).toEqual({ agent: { default: "claude" } });
    expect(attendedSession({ HUB_HOME: dir, HUB_PROJECT: "acme" })).toBe(true);
    expect(attendedSession({ HUB_HOME: dir, HUB_PROJECT: "acme", HUB_AUTOPILOT_CHAT: "12" })).toBe(false);
    expect(attendedSession({ HUB_HOME: dir, HUB_PROJECT: "acme", HUB_FOLLOWUP_CLIENT: "7" })).toBe(false);
  }, 30_000);
});

describe("hub mcp offers messenger_send only with the attended port", () => {
  it("without the port (a background run) the tools are exactly HUB_MCP_TOOLS, none send-like", async () => {
    const { names } = await toolsOf();
    expect(names).toEqual([...HUB_MCP_TOOLS].sort());
    expect(names.filter((n) => SEND_LIKE_TOOL.test(n))).toEqual([]);
  });

  it("with it (the owner's session) messenger_send is the one addition, and no tool sends Mail", async () => {
    const { names } = await toolsOf(async () => ({ ok: false, status: 409, reason: "no_owner_word", error: "Not sent.", next: "Ask." }));
    expect(HUB_MCP_ATTENDED_TOOLS).toEqual([MESSENGER_SEND_TOOL]);
    expect(names).toEqual([...HUB_MCP_TOOLS, ...HUB_MCP_ATTENDED_TOOLS].sort());
    expect(names.filter((n) => SEND_LIKE_TOOL.test(n))).toEqual(["messenger_send"]);
    expect(names.filter((n) => /mail/i.test(n) && SEND_LIKE_TOOL.test(n))).toEqual([]);
  });

  it("the tool passes the chat and draft to the port, returns the dock line on a send and the code and next step on a refusal", async () => {
    const calls: Array<[string, number, number]> = [];
    let answer: Awaited<ReturnType<AgentSendPort>> = { ok: true, sendId: 5, channel: "telegram_user", chatId: "1001", to: "Anna", text: "Yes, the 28th stands.", at: "2026-11-23T11:58:00.000Z" };
    const { client } = await toolsOf(async (slug, draft, chat) => {
      calls.push([slug, draft, chat]);
      return answer;
    });
    const sent = await client.callTool({ name: "messenger_send", arguments: { chat: 3, draft: 7 } });
    expect(calls).toEqual([["acme", 7, 3]]);
    const body = JSON.parse((sent.content as Array<{ text: string }>)[0]!.text) as Record<string, unknown>;
    expect(body).toMatchObject({ sent: true, send_id: 5, to: "Anna", channel: "telegram_user" });
    expect(String(body.next)).toContain('Sent to Anna on Telegram at 11:58 UTC: "Yes, the 28th stands."');
    answer = { ok: false, status: 409, reason: "word_before_draft", error: "Not sent: the word came first.", next: "Ask him again." };
    const refused = await client.callTool({ name: "messenger_send", arguments: { chat: 3, draft: 7 } });
    expect(refused.isError).toBe(true);
    expect((refused.content as Array<{ text: string }>)[0]!.text).toMatch(/word_before_draft[\s\S]*Next: Ask him again\./);
  });

  it("the loopback port presents the token and names the agent-send route; with no token it refuses without a call", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response(JSON.stringify({ error: "Not sent: x", code: "wrong_state", reason: "no_owner_word", next: "Ask." }), { status: 409 });
    }) as unknown as typeof fetch;
    const port = httpAgentSend({ port: () => 4999, token: () => "t0k", fetch: fake });
    expect(await port("acme", 7, 3)).toEqual({ ok: false, status: 409, reason: "no_owner_word", error: "Not sent: x", next: "Ask." });
    expect(seen).toEqual([{ url: "http://127.0.0.1:4999/api/projects/acme/messengers/drafts/7/agent-send", headers: { "content-type": "application/json", "x-hub-agent-token": "t0k" }, body: '{"chat":3}' }]);
    const none = httpAgentSend({ port: () => 4999, token: () => null, fetch: fake });
    expect(await none("acme", 7, 3)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(seen).toHaveLength(1);
    expect(sentLine({ to: "Bo", channel: "whatsapp", text: "a\nb", at: "2026-11-23T09:05:00.000Z" })).toBe('Sent to Bo on WhatsApp at 09:05 UTC: "a b"');
  });
});

describe("decision 0048: an autopilot turn has no send tool (P139 A3, verdict 28)", () => {
  it("its hub mcp registers exactly the five bound tools, none send-like, attended port or not", async () => {
    const server = createHubMcpServer(createRepos(h.db), { hubProject: "acme", focusFile: path.join(dir, "focus.json"), autopilotChat: 1, agentSend: async () => ({ ok: false, status: 409, reason: "no_owner_word", error: "Not sent.", next: "Ask." }) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...AUTOPILOT_HUB_TOOLS].sort());
    expect(names).not.toContain("messenger_send");
  });

  it("its CLI denies messenger_send and every other hub tool by name, and the background run's deny list", () => {
    const denied = autopilotDisallowed();
    expect(denied).toContain(SEND);
    for (const t of deniedTools("background")) expect(denied).toContain(t);
    expect(AUTOPILOT_ALLOWED.filter((t) => SEND_LIKE_TOOL.test(t.replace("mcp__hub__", "")) && t !== "mcp__hub__messenger_draft_write")).toEqual([]);
  });
});

describe("decision 0055: a lead pass turn has no send tool (P147 verdict 16)", () => {
  it("E1: the Workflow tool is denied in every Hub session, the owner's and the background's", () => {
    expect(deniedTools("owner")).toContain("Workflow");
    expect(deniedTools("background")).toContain("Workflow");
    expect(leadPassDisallowed()).toContain("Workflow");
  });

  it("its hub mcp registers exactly verdict 5's eight lead-bound tools (3e: link_fetch, 3g: bug_report), none send-like, attended port or not", async () => {
    const server = createHubMcpServer(createRepos(h.db), { hubProject: "acme", focusFile: path.join(dir, "focus.json"), leadPage: "a".repeat(32), leadPass: 1, agentSend: async () => ({ ok: false, status: 409, reason: "no_owner_word", error: "Not sent.", next: "Ask." }) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["bug_report", "client_show", "draft_write", "knowledge_get", "knowledge_search", "lead_decide", "link_fetch", "message_show"]);
    expect(names).toEqual([...LEAD_PASS_HUB_TOOLS].sort());
    expect(names.filter((n) => SEND_LIKE_TOOL.test(n))).toEqual([]);
  });

  it("its CLI allows the eight and denies messenger_send, client_create and every other hub tool by name, and the background run's deny list", () => {
    expect(LEAD_PASS_ALLOWED).toHaveLength(8);
    const denied = leadPassDisallowed();
    expect(denied).toContain(SEND);
    expect(denied).toContain("mcp__hub__client_create");
    expect(denied).toContain("mcp__hub__leads_open");
    for (const t of deniedTools("background")) expect(denied).toContain(t);
    for (const t of LEAD_PASS_ALLOWED) expect(denied).not.toContain(t);
  });
});
