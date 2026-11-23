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

// Decision 0046 (P132 B1-3): `messenger_send` exists only in an attended session. Unattended it is absent from `hub mcp`, on
// Claude's deny list and `--disallowedTools`, in Codex's `disabled_tools`; attended it is the one send tool, and Mail has none.

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

describe("the deny list by mode (decision 0046)", () => {
  it("unattended denies messenger_send everywhere; attended keeps every other denial and drops only that one", () => {
    expect(ATTENDED_SEND_TOOLS).toEqual([SEND]);
    expect(DENIED_TOOLS).not.toContain(SEND);
    expect(deniedTools(true)).toEqual([...DENIED_TOOLS, SEND]);
    expect(deniedTools(false)).toEqual(DENIED_TOOLS);
    expect(deniedTools()).toContain(SEND);
    expect(deniedToolsOf("hub", true)).toEqual(["messenger_send"]);
    expect(deniedToolsOf("hub", false)).toEqual([]);
    expect(claudeDisallowed([], true)).toContain(SEND);
    expect(claudeDisallowed([], false)).not.toContain(SEND);
    const paths = pathsAt(dir);
    expect(denyRules(path.join(dir, "projects"), dir, "acme", paths, true)).toContain(SEND);
    expect(denyRules(path.join(dir, "projects"), dir, "acme", paths, false)).not.toContain(SEND);
    // Every Mail send door stays denied attended too.
    for (const t of DENIED_TOOLS) expect(denyRules(path.join(dir, "projects"), dir, "acme", paths, false)).toContain(t);
  });

  it("the generated session files follow the mode: Claude's deny rules and Codex's disabled_tools", () => {
    const paths = pathsAt(dir);
    const deny = (unattended: boolean) => (claudeSettings({ paths, projectsDir: path.join(dir, "projects"), slug: "acme", nodeBin: "node", unattended }).permissions as { deny: string[] }).deny;
    expect(deny(true)).toContain(SEND);
    expect(deny(false)).not.toContain(SEND);
    const toml = (unattended: boolean) => codexConfigToml({ paths, projectsDir: path.join(dir, "projects"), slug: "acme", unattended, servers: { hub: { type: "stdio", command: "node", args: ["hub.mjs", "mcp"] } }, instructions: "x" });
    const hub = (t: string) => t.slice(t.indexOf('[mcp_servers."hub"]')).split(/\n\[(?!")/)[0] ?? "";
    expect(hub(toml(true))).toContain('disabled_tools = ["messenger_send"]');
    expect(toml(false)).not.toMatch(/messenger_send/);
  });
});

describe("hub mcp offers messenger_send only with the attended port", () => {
  it("without the port (unattended) the tools are exactly HUB_MCP_TOOLS, none send-like", async () => {
    const { names } = await toolsOf();
    expect(names).toEqual([...HUB_MCP_TOOLS].sort());
    expect(names.filter((n) => SEND_LIKE_TOOL.test(n))).toEqual([]);
  });

  it("with it (attended) messenger_send is the one addition, and no tool sends Mail", async () => {
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
