import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTOPILOT_CHAT_ENV, AUTOPILOT_DRAFT_AUTHOR, AUTOPILOT_HUB_TOOLS, type BrainTurn } from "@hub/config/autopilot";
import { createRepos, openDb, openDbReadOnly, type DbHandle, type Repos } from "@hub/db";
import { AUTOPILOT_ALLOWED, autopilotArgs, autopilotDisallowed, autopilotEnv, autopilotMcp, autopilotPrompt, autopilotSettings, claudeBrain, initRefusal, turnStream, type Spawn } from "../src/autopilot";
import { createHubMcpServer, HUB_MCP_ATTENDED_TOOLS, HUB_MCP_TOOLS } from "../src/mcp/server";
import { autopilotChatOf } from "../src/mcp/stdio";
import type { WithRepos } from "../src/mail/write-log";

// Decision 0048 (P139 A3): the autopilot turn's brain (one `claude -p` per turn, never spawned here: a fake child plays the CLI's
// stream), the six runner rules of A0, and the hub MCP binding of a turn to its one chat (verdicts 20, 28).

const turn = (over: Partial<BrainTurn> = {}): BrainTurn => ({ chat: { project: "acme", channel: "telegram_user", chatId: "42", chat: 1 }, actionId: "t-abc123", burst: { messages: 2, firstAt: "2026-11-25T09:00:00.000Z" }, mode: "on", revise: null, disclose: false, ...over });

const line = (v: unknown) => `${JSON.stringify(v)}\n`;
const INIT = { type: "system", subtype: "init", mcp_servers: [{ name: "hub", status: "connected" }], tools: [...AUTOPILOT_ALLOWED] };
const writeCall = (id: string, text: string, verdict: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "mcp__hub__messenger_draft_write", input: { chat: 1, text, autopilot: { verdict, reason: "a plain answer" } } }] } });
const writeAnswer = (id: string, body: unknown, isError = false) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: [{ type: "text", text: JSON.stringify(body) }] }] } });
const RESULT = { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.031, permission_denials: [], result: "Done." };

describe("the stream of a turn (A0 rules 4 and 5)", () => {
  it("reads the init event, the draft the turn's own call wrote and answered, and the result", () => {
    const s = turnStream();
    expect(s.push(line(INIT))).toEqual({ hub: "connected", tools: [...AUTOPILOT_ALLOWED] });
    s.push(line(writeCall("u1", " Hello, it works like this. ", "send")));
    s.push(line(writeAnswer("u1", { project: "acme", draft: 7, action: "created" })));
    s.push("not json at all");
    s.push(line(RESULT));
    expect(s.done()).toEqual({ init: { hub: "connected", tools: [...AUTOPILOT_ALLOWED] }, draft: { draftId: 7, text: "Hello, it works like this.", verdict: "send", reason: "a plain answer" }, final: { isError: false, costUsd: 0.031, denials: 0, result: "Done.", subtype: "success" } });
  });

  it("a refused write gives no draft, and a write with no verdict is not a draft", () => {
    const s = turnStream();
    s.push(line(writeCall("u1", "x", "send")));
    s.push(line(writeAnswer("u1", { error: "already_drafted" }, true)));
    s.push(line({ type: "assistant", message: { content: [{ type: "tool_use", id: "u2", name: "mcp__hub__messenger_draft_write", input: { chat: 1, text: "y" } }] } }));
    s.push(line(writeAnswer("u2", { draft: 9 })));
    expect(s.done().draft).toBeNull();
  });

  it("runs only with hub connected and exactly the five tools", () => {
    expect(initRefusal({ hub: "connected", tools: [...AUTOPILOT_ALLOWED].reverse() }, AUTOPILOT_ALLOWED)).toBeNull();
    expect(initRefusal({ hub: "pending", tools: [] }, AUTOPILOT_ALLOWED)).toMatch(/pending/);
    expect(initRefusal({ hub: "connected", tools: [...AUTOPILOT_ALLOWED, "Bash"] }, AUTOPILOT_ALLOWED)).toMatch(/Bash/);
    expect(initRefusal({ hub: "connected", tools: [...AUTOPILOT_ALLOWED, "mcp__hub__messenger_send"] }, AUTOPILOT_ALLOWED)).toMatch(/messenger_send/);
  });
});

describe("the turn's files and flags (A0 rules 1, 2, 3, 6)", () => {
  it("no built-in tool, the five allowed, every other hub tool denied by name, no session file, the skill appended", () => {
    const args = autopilotArgs({ settings: "/s.json", mcp: "/m.json", skill: "/k.md" });
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--mcp-config=/m.json");
    expect(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 2)).toEqual(["--output-format", "stream-json"]);
    expect(args).toContain("--verbose");
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "sonnet"]);
    expect(args.slice(args.indexOf("--append-system-prompt-file"), args.indexOf("--append-system-prompt-file") + 2)).toEqual(["--append-system-prompt-file", "/k.md"]);
    // No client text and no prompt in argv: the prompt goes on stdin.
    expect(args.filter((a) => a.startsWith("Autopilot turn"))).toEqual([]);
  });

  it("the denied list is every hub tool but the six, the attended send included; the two lists cover every hub tool", () => {
    const denied = autopilotDisallowed();
    expect(denied).toContain("mcp__hub__messenger_send");
    expect(denied).toContain("mcp__hub__client_map");
    for (const t of AUTOPILOT_ALLOWED) expect(denied).not.toContain(t);
    const hub = [...HUB_MCP_TOOLS, ...HUB_MCP_ATTENDED_TOOLS].map((t) => `mcp__hub__${t}`);
    expect(hub.filter((t) => !denied.includes(t)).sort()).toEqual([...AUTOPILOT_ALLOWED].sort());
    expect(AUTOPILOT_HUB_TOOLS).toEqual(["messenger_history", "client_show", "knowledge_search", "knowledge_get", "messenger_draft_write", "conversation_done"]);
  });

  it("settings: no hooks, the advisor off, the five pre-approved; the MCP file binds the project and the chat", () => {
    const s = autopilotSettings("/h/state/projects/acme/autopilot/1", "/Users/o");
    expect(s).toMatchObject({ model: "sonnet", disableAllHooks: true, env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" }, permissions: { allow: [...AUTOPILOT_ALLOWED] } });
    expect(s).not.toHaveProperty("hooks");
    expect((s.claudeMdExcludes as string[]).filter((x) => x === "/Users/o/.claude/CLAUDE.md")).toHaveLength(1);
    const m = autopilotMcp({ paths: { home: "/h", hubBin: "/core/hub.mjs" }, nodeBin: "/node/bin/node", turn: turn(), capability: "cap" }) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
    expect(Object.keys(m.mcpServers)).toEqual(["hub"]);
    expect(m.mcpServers.hub).toMatchObject({ command: "/node/bin/node", args: ["/core/hub.mjs", "mcp"], env: { HUB_HOME: "/h", HUB_PROJECT: "acme", HUB_PROJECT_CAPABILITY: "cap", [AUTOPILOT_CHAT_ENV]: "1", HUB_ACTION: "t-abc123" } });
  });

  it("env: USER, HOME and PATH with the Hub's Node first, MCP waits, the advisor off, and nothing of the server's HUB_* or keys", () => {
    const e = autopilotEnv({ HOME: "/Users/o", USER: "o", PATH: "/usr/bin:/bin", HUB_PROJECT: "x", HUB_PROJECT_CAPABILITY: "y", CLAUDECODE: "1", ANTHROPIC_API_KEY: "k" }, "/n/bin/node");
    expect(e).toMatchObject({ HOME: "/Users/o", USER: "o", PATH: "/n/bin:/usr/bin:/bin", MCP_CONNECTION_NONBLOCKING: "false", CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" });
    for (const k of ["HUB_PROJECT", "HUB_PROJECT_CAPABILITY", "CLAUDECODE", "ANTHROPIC_API_KEY"]) expect(e).not.toHaveProperty(k);
    expect(autopilotEnv({}, "/n/bin/node").USER).toBeTruthy();
  });

  it("the prompt carries facts only: the chat, the burst, the draft to revise, the line, the mode", () => {
    const p = autopilotPrompt(turn({ revise: 5, disclose: true, mode: "dry_run" }));
    expect(p).toMatch(/chat:1/);
    expect(p).toMatch(/draft=5/);
    expect(p).toMatch(/assistant line/);
    expect(p).toMatch(/Dry run/);
  });
});

/** A fake `claude`: records its call, then plays `lines` on stdout and exits; SIGTERM ends it at once. */
function fakeClaude(lines: unknown[], o: { hang?: boolean } = {}) {
  const calls: Array<{ cmd: string; args: readonly string[]; cwd: string | undefined; env: NodeJS.ProcessEnv | undefined; stdin: string }> = [];
  const spawn: Spawn = (cmd, args, opts) => {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const call = { cmd, args, cwd: opts.cwd?.toString(), env: opts.env, stdin: "" };
    calls.push(call);
    stdin.on("data", (b: Buffer) => (call.stdin += b.toString()));
    Object.assign(child, { stdout, stderr, stdin, exitCode: null, signalCode: null });
    const exit = (code: number | null, signal: string | null) => {
      Object.assign(child, { exitCode: code, signalCode: signal });
      stdout.end();
      setImmediate(() => child.emit("close", code, signal));
    };
    child.kill = ((sig?: NodeJS.Signals) => {
      exit(null, sig ?? "SIGTERM");
      return true;
    }) as ChildProcess["kill"];
    setImmediate(() => {
      for (const l of lines) stdout.write(line(l));
      if (!o.hang) exit(0, null);
    });
    return child;
  };
  return { spawn, calls };
}

describe("claudeBrain (a fake CLI)", () => {
  let home: string;
  const paths = () => ({ home, stateProjects: path.join(home, "state", "projects"), secrets: path.join(home, "state", "secrets"), skills: path.join(home, "skills"), hubBin: path.join(home, "hub.mjs"), db: path.join(home, "data", "app.db") });
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "hub-autopilot-brain-"));
    mkdirSync(path.join(home, "skills", "autopilot-reply"), { recursive: true });
    writeFileSync(path.join(home, "skills", "autopilot-reply", "SKILL.md"), "---\nname: autopilot-reply\n---\n\n# Rules\nHand back when unsure.\n");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const signal = () => new AbortController();

  it("spawns claude beside the Hub's Node in the chat's own folder, the prompt on stdin, and answers the turn's own draft", async () => {
    const f = fakeClaude([INIT, writeCall("u1", "Sure, here is how.", "send"), writeAnswer("u1", { draft: 12 }), RESULT]);
    const r = await claudeBrain({ paths: paths(), nodeBin: "/n/bin/node", spawn: f.spawn, env: { HOME: home, USER: "o", PATH: "/usr/bin" } }).turn(turn(), signal().signal);
    expect(r).toEqual({ kind: "draft", draftId: 12, text: "Sure, here is how.", verdict: "send", reason: "a plain answer", costUsd: 0.031 });
    const c = f.calls[0]!;
    expect(c.cmd).toBe("/n/bin/claude");
    expect(c.cwd).toBe(path.join(home, "state", "projects", "acme", "autopilot", "1"));
    expect(c.stdin).toMatch(/^Autopilot turn t-abc123/);
    expect(readFileSync(path.join(c.cwd!, "skill.md"), "utf8")).toMatch(/Hand back when unsure/);
    expect(readFileSync(path.join(c.cwd!, "skill.md"), "utf8")).not.toMatch(/name: autopilot-reply/);
  });

  it("kills a turn whose init shows another tool or a pending hub, and refuses it mcp_not_ready", async () => {
    const f = fakeClaude([{ ...INIT, tools: [...AUTOPILOT_ALLOWED, "Bash"] }], { hang: true });
    const r = await claudeBrain({ paths: paths(), nodeBin: "/n/bin/node", spawn: f.spawn, env: { USER: "o" } }).turn(turn(), signal().signal);
    expect(r).toMatchObject({ kind: "failed", code: "mcp_not_ready" });
  });

  it("is_error, a permission denial, or no draft: never a draft", async () => {
    const brain = (lines: unknown[]) => claudeBrain({ paths: paths(), nodeBin: "/n/bin/node", spawn: fakeClaude(lines).spawn, env: { USER: "o" } }).turn(turn(), signal().signal);
    expect(await brain([INIT, { ...RESULT, subtype: "success", is_error: true, result: "auth" }])).toMatchObject({ kind: "failed" });
    expect(await brain([INIT, writeCall("u1", "x", "send"), writeAnswer("u1", { draft: 3 }), { ...RESULT, permission_denials: [{ tool_name: "Bash" }] }])).toMatchObject({ kind: "failed" });
    expect(await brain([INIT, { ...RESULT, result: "A thanks owes no reply." }])).toEqual({ kind: "no_draft", reason: "A thanks owes no reply.", costUsd: 0.031 });
  });

  it("an abort (the wall clock, a newer message) ends the CLI", async () => {
    const f = fakeClaude([INIT], { hang: true });
    const ctl = signal();
    const p = claudeBrain({ paths: paths(), nodeBin: "/n/bin/node", spawn: f.spawn, env: { USER: "o" } }).turn(turn(), ctl.signal);
    setTimeout(() => ctl.abort(), 5);
    expect(await p).toMatchObject({ kind: "failed", detail: "aborted" });
  });

  it("fails without the skill rather than run bare", async () => {
    rmSync(path.join(home, "skills"), { recursive: true, force: true });
    const f = fakeClaude([INIT, RESULT]);
    expect(await claudeBrain({ paths: paths(), nodeBin: "/n/bin/node", spawn: f.spawn }).turn(turn(), signal().signal)).toMatchObject({ kind: "failed" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("hub mcp bound to one autopilot chat (verdict 20)", () => {
  let dir: string;
  let db: string;
  let rw: DbHandle;
  let ro: DbHandle;
  let w: Repos;
  const ids = { ann: 0, bob: 0, chat42: 0, chat43: 0 };
  const msg = (chatId: string, remote: string, direction: "in" | "out", sentAt: string) => ({ project: "acme", channel: "telegram_user" as const, account: "1", chatId, remoteMessageId: remote, direction, kind: "text", text: `${direction} ${remote}`, sentAt, retainUntil: "2027-02-18T00:00:00.000Z" });
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "hub-autopilot-mcp-"));
    db = path.join(dir, "app.db");
    rw = openDb(db);
    w = createRepos(rw.db);
    ids.ann = await w.clients.create({ project: "acme", email: "ann@example.com", name: "Ann" });
    ids.bob = await w.clients.create({ project: "acme", email: "bob@example.com", name: "Bob" });
    await w.messengers.addIdentifier("acme", ids.ann, "telegram", "42");
    await w.messengers.knowChat("acme", "telegram_user", "42", { title: "Ann" });
    ids.chat42 = (await w.messengers.chat("acme", "telegram_user", "42"))!.id;
    await w.messengers.addIdentifier("acme", ids.bob, "telegram", "43");
    await w.messengers.knowChat("acme", "telegram_user", "43", { title: "Bob" });
    ids.chat43 = (await w.messengers.chat("acme", "telegram_user", "43"))!.id;
    await w.messengers.insertMessage(msg("42", "1", "in", "2026-11-25T09:00:00.000Z"));
    await w.messengers.insertMessage(msg("43", "1", "in", "2026-11-25T09:00:00.000Z"));
    ro = openDbReadOnly(db);
  });
  afterEach(() => {
    ro.close();
    rw.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const withRepos: WithRepos = async (fn) => {
    const h = openDb(db);
    try {
      return await fn(createRepos(h.db));
    } finally {
      h.close();
    }
  };
  async function connect(autopilotChat: number | undefined, attended = false) {
    const server = createHubMcpServer(createRepos(ro.db), {
      hubProject: "acme",
      focusFile: path.join(dir, "focus.json"),
      withRepos,
      ...(autopilotChat !== undefined ? { autopilotChat } : {}),
      ...(attended ? { ownerWords: () => true, agentSend: async () => ({ ok: false as const, status: 409, reason: "refused", error: "x", next: "y" }) } : {}),
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(a);
    return {
      names: async () => (await client.listTools()).tools.map((t) => t.name).sort(),
      call: async (name: string, args: Record<string, unknown>) => {
        const res = await client.callTool({ name, arguments: args });
        return { isError: res.isError === true, json: JSON.parse((res.content as Array<{ text: string }>)[0]?.text ?? "{}") as Record<string, unknown> };
      },
    };
  }

  it("registers exactly the five tools, even on an attended instance", async () => {
    expect(await (await connect(ids.chat42, true)).names()).toEqual([...AUTOPILOT_HUB_TOOLS].sort());
  });

  it("refuses another chat, another client and another client's chats", async () => {
    const t = await connect(ids.chat42);
    expect((await t.call("messenger_history", { chat: ids.chat43 })).json.error).toBe("autopilot_other_chat");
    expect((await t.call("messenger_history", { channel: "telegram_user", chat_id: "43" })).json.error).toBe("autopilot_other_chat");
    expect((await t.call("messenger_history", { client: ids.bob })).json.error).toBe("autopilot_other_chat");
    expect((await t.call("client_show", { id: ids.bob })).json.error).toBe("autopilot_other_chat");
    expect((await t.call("messenger_draft_write", { chat: ids.chat43, text: "hi", autopilot: { verdict: "send", reason: "plain" } })).json.error).toBe("autopilot_other_chat");
    const own = await t.call("messenger_history", { client: ids.ann });
    expect(own.isError).toBe(false);
    expect((own.json.chats as Array<{ id: number }>).map((c) => c.id)).toEqual([ids.chat42]);
    expect((await t.call("client_show", { id: ids.ann })).isError).toBe(false);
  });

  it("the draft carries its verdict, is autopilot's, and revises only autopilot's own draft", async () => {
    const t = await connect(ids.chat42);
    expect((await t.call("messenger_draft_write", { chat: ids.chat42, text: "hi" })).json.error).toBe("autopilot_verdict");
    const made = await t.call("messenger_draft_write", { chat: ids.chat42, text: " Hello Ann. ", autopilot: { verdict: "send", reason: "a plain answer" } });
    expect(made.isError).toBe(false);
    const id = made.json.draft as number;
    expect(await w.messengers.getDraft("acme", id)).toMatchObject({ createdBy: AUTOPILOT_DRAFT_AUTHOR, text: "Hello Ann.", status: "draft" });
    expect((await t.call("messenger_draft_write", { chat: ids.chat42, text: "Hello again.", draft: id, autopilot: { verdict: "hand_back", reason: "asked about a price" } })).isError).toBe(false);
    // The owner takes it over: no later turn touches it.
    await w.messengers.reviseDraft("acme", id, "My own words.", { createdBy: "owner" });
    expect((await t.call("messenger_draft_write", { chat: ids.chat42, text: "x", draft: id, autopilot: { verdict: "send", reason: "plain" } })).json.error).toBe("already_drafted");
  });

  it("outside a turn the verdict field is refused, and the env binds only a row id", async () => {
    const t = await connect(undefined);
    expect((await t.call("messenger_draft_write", { chat: ids.chat42, text: "hi", autopilot: { verdict: "send", reason: "plain" } })).json.error).toBe("invalid");
    expect(autopilotChatOf({})).toBeUndefined();
    expect(autopilotChatOf({ [AUTOPILOT_CHAT_ENV]: "12" })).toBe(12);
    expect(autopilotChatOf({ [AUTOPILOT_CHAT_ENV]: "all" })).toBe(0);
  });
});
