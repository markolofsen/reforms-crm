import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importRollout, rolloutEvents } from "../src/codex-rollout";
import { hookEvents, promptEvents, toolCallEvents, toolResultEvent } from "../src/hooks";
import { hashed, toolInput, toolOutput } from "../src/privacy";
import { appendEvent, appendEvents, readEvents, type LogStore } from "../src/store";
import type { LogEvent } from "../src/event";
import { notionWriteOf } from "../src/notion-writes";
import { endsInQuestion, frictionTotal, summarize } from "../src/summary";

const storeOf = (retentionDays = 90): LogStore => {
  const root = mkdtempSync(path.join(tmpdir(), "hub-log-"));
  mkdirSync(path.join(root, "secrets"));
  return { dir: path.join(root, "log"), secrets: path.join(root, "secrets"), retentionDays };
};
const NOW = new Date("2026-11-19T10:00:00.000Z");
const base = { session: "sess-1", hook_event_name: "Stop", prompt_id: "p1", transcript_path: "/t/sess-1.jsonl" };

describe("the writer", () => {
  it("writes one redacted line per event into the project's day file, mode 600", () => {
    const s = storeOf();
    writeFileSync(path.join(s.secrets, "notion-token"), "ntn_THEOWNERSREALTOKEN123\n", { mode: 0o600 });
    expect(appendEvent(s, { project: "acme", session: "s1", cli: "claude", kind: "prompt", data: { text: "use ntn_THEOWNERSREALTOKEN123 and sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX please" } }, NOW)).toBe(true);
    const file = path.join(s.dir, "acme", "2026-11-19.jsonl");
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("THEOWNERSREALTOKEN");
    expect(text).not.toContain("ABCDEFGHIJKLMNOP");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const [e] = readEvents(s);
    expect(e).toMatchObject({ v: 1, ts: NOW.toISOString(), project: "acme", session: "s1", cli: "claude", kind: "prompt" });
  });
  it("an unbound session writes _unbound; a huge line keeps its envelope", () => {
    const s = storeOf();
    appendEvent(s, { project: null, session: "s2", cli: "codex", kind: "answer", data: { a: "x".repeat(10_000), b: "y".repeat(10_000) } }, NOW);
    const [e] = readEvents(s, { project: "_unbound" });
    expect(e?.data).toMatchObject({ truncated: true });
    expect(e?.session).toBe("s2");
  });
  it("the first write of a day deletes files past the retention; a torn line is skipped", () => {
    const s = storeOf(30);
    const dir = path.join(s.dir, "acme");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "2026-09-01.jsonl"), "");
    writeFileSync(path.join(dir, "2026-11-01.jsonl"), "{torn\n");
    appendEvent(s, { project: "acme", session: "s", cli: "claude", kind: "prompt", data: { text: "hi" } }, NOW);
    expect(readdirSync(dir).sort()).toEqual(["2026-11-01.jsonl", "2026-11-19.jsonl"]);
    expect(readEvents(s)).toHaveLength(1);
  });
  it("never throws: an unwritable folder is false", () => {
    const s = { ...storeOf(), dir: "/dev/null/log" };
    expect(appendEvents(s, [{ project: "a", session: "s", cli: "claude", kind: "prompt", data: {} }])).toBe(false);
  });
  it("filters by session prefix, kind, cli and time", () => {
    const s = storeOf();
    appendEvents(s, [
      { project: "a", session: "aaaa-1", cli: "claude", kind: "prompt", data: {}, ts: "2026-11-18T09:00:00.000Z" },
      { project: "a", session: "aaaa-1", cli: "claude", kind: "answer", data: {}, ts: "2026-11-19T09:00:00.000Z" },
      { project: "b", session: "bbbb-2", cli: "codex", kind: "prompt", data: {}, ts: "2026-11-19T09:30:00.000Z" },
    ]);
    expect(readEvents(s, { session: "aaaa" })).toHaveLength(2);
    expect(readEvents(s, { kinds: ["prompt"] }).map((e) => e.session)).toEqual(["aaaa-1", "bbbb-2"]);
    expect(readEvents(s, { cli: "codex" })).toHaveLength(1);
    expect(readEvents(s, { since: "2026-11-19T00:00:00.000Z" })).toHaveLength(2);
    expect(readEvents(s, { project: "b" })).toHaveLength(1);
  });
});

describe("privacy", () => {
  it("a mail body is a hash and a length, in an input and in a result; headers stay", () => {
    const body = "Dear Mark, the price is 100 EUR";
    expect(toolInput("mcp__hub__draft_write", { account: "acc", content: body })).toEqual({ account: "acc", content: { body: hashed(body) } });
    expect(toolOutput("mcp__mail-mcp__get_message_content", { content: body })).toEqual({ body: hashed(JSON.stringify({ content: body })) });
    expect(toolOutput("mcp__mail-mcp__find_messages", "Re: Hello from mark@x.example")).toBe("Re: Hello from mark@x.example");
    expect(toolOutput("Bash", "y".repeat(5000))).toMatch(/cut, 5000 chars/);
  });

  it("P71: a chat's text is kept like a mail body: the draft's text and the history's reply are hashes", () => {
    const text = "Привет, цена 100 EUR";
    expect(toolInput("mcp__hub__messenger_draft_write", { channel: "telegram_user", chat_id: "42", text })).toEqual({ channel: "telegram_user", chat_id: "42", text: { body: hashed(text) } });
    expect(toolOutput("mcp__hub__messenger_history", { chats: [{ messages: [{ text }] }] })).toEqual({ body: hashed(JSON.stringify({ chats: [{ messages: [{ text }] }] })) });
  });
});

describe("hook payloads", () => {
  it("Claude: prompt with its focus line; the answer with the transcript; one turn id", () => {
    const p = { session_id: "s1", prompt_id: "p1", prompt: "ответь этому клиенту" };
    expect(promptEvents(p, "claude", "acme", "[Hub focus, data] draft 1").map((e) => [e.kind, e.turn])).toEqual([["prompt", "p1"], ["focus", "p1"]]);
    const [a] = hookEvents({ ...base, session_id: "s1", last_assistant_message: "Done." }, "claude", "acme");
    expect(a).toMatchObject({ kind: "answer", turn: "p1", data: { text: "Done.", transcript: "/t/sess-1.jsonl" } });
  });
  it("waits on the owner are asked; other notifications are not logged", () => {
    expect(hookEvents({ session_id: "s", hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission" }, "claude", "a")[0]).toMatchObject({ kind: "asked", data: { why: "permission_prompt" } });
    expect(hookEvents({ session_id: "s", hook_event_name: "Notification", notification_type: "auth_success" }, "claude", "a")).toEqual([]);
    expect(hookEvents({ session_id: "s", hook_event_name: "PermissionRequest", turn_id: "t", tool_name: "Bash", tool_input: { command: "ls" } }, "codex", "a")[0]).toMatchObject({ kind: "asked", turn: "t", data: { why: "permission_request", tool: "Bash" } });
  });
  it("tool call, result, failure share the tool id; no session id is no event", () => {
    const c = toolCallEvents({ session_id: "s", tool_use_id: "tu", tool_name: "Read", tool_input: { file_path: "x" } }, "claude", "a", { mode: "warn", violations: ["v1"] });
    expect(c.map((e) => [e.kind, e.corr])).toEqual([["tool_call", "tu"], ["guard", "tu"]]);
    expect(toolResultEvent({ session_id: "s", tool_use_id: "tu", tool_name: "Read", tool_response: "ok", duration_ms: 12 }, "claude", "a")).toMatchObject({ kind: "tool_result", corr: "tu", data: { output: "ok", ms: 12 } });
    expect(hookEvents({ session_id: "s", hook_event_name: "PostToolUseFailure", tool_use_id: "tu", tool_name: "Bash", error: "Exit code 1" }, "claude", "a")[0]).toMatchObject({ kind: "tool_error", data: { error: "Exit code 1" } });
    expect(hookEvents({ hook_event_name: "Stop" }, "claude", "a")).toEqual([]);
  });
});

describe("the Codex rollout import", () => {
  const lines = [
    { timestamp: "2026-11-19T10:00:00Z", type: "turn_context", payload: { turn_id: "t1" } },
    { timestamp: "2026-11-19T10:00:01Z", type: "response_item", payload: { type: "function_call", name: "find_messages", namespace: "mcp__mail-mcp", arguments: '{"account":"a"}', call_id: "c1" } },
    { timestamp: "2026-11-19T10:00:02Z", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "3 messages" } },
    { timestamp: "2026-11-19T10:00:03Z", type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "ls", call_id: "c2" } },
    { timestamp: "2026-11-19T10:00:04Z", type: "event_msg", payload: { type: "task_complete" } },
  ].map((l) => JSON.stringify(l));
  it("both call shapes, the namespace in the tool name, the turn from turn_context", () => {
    const ev = rolloutEvents(lines.join("\n"), { project: "a", session: "s" });
    expect(ev.map((e) => [e.kind, e.corr, e.turn, e.data.tool])).toEqual([["tool_call", "c1", "t1", "mcp__mail-mcp__find_messages"], ["tool_result", "c1", "t1", "mcp__mail-mcp__find_messages"], ["tool_call", "c2", "t1", "exec"]]);
  });
  it("code mode: a script that calls a mail tool keeps its code and output as hashes; the tools it names are kept", () => {
    const code = 'const r = await tools.mcp__mail_mcp_placeholder({}); await tools.mcp__mail-mcp__get_message_content({id: 1});';
    const ev = rolloutEvents([
      JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: code, call_id: "x1" } }),
      JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "x1", output: "Dear Mark, the price is 100 EUR" } }),
      JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "await tools.mcp__hub__focus({})", call_id: "x2" } }),
    ].join("\n"), { project: "a", session: "s" });
    expect(ev[0]?.data).toMatchObject({ tool: "exec", input: { code: hashed(code) }, via: expect.arrayContaining(["mcp__mail-mcp__get_message_content"]) });
    expect(JSON.stringify(ev[1]?.data)).not.toContain("price");
    expect(ev[2]?.data).toMatchObject({ input: "await tools.mcp__hub__focus({})", via: ["mcp__hub__focus"] });
  });
  it("imports each line once, from a cursor; the output of an earlier call keeps its tool name", () => {
    const s = storeOf();
    const file = path.join(s.secrets, "..", "rollout.jsonl");
    writeFileSync(file, lines.slice(0, 2).join("\n") + "\n");
    expect(importRollout(s, { file, project: "a", session: "s" })).toBe(1);
    appendFileSync(file, lines.slice(2).join("\n") + "\n" + '{"partial":');
    expect(importRollout(s, { file, project: "a", session: "s" })).toBe(2);
    expect(importRollout(s, { file, project: "a", session: "s" })).toBe(0);
    const ev = readEvents(s, { project: "a" });
    expect(ev.map((e) => e.data.tool)).toEqual(["mcp__mail-mcp__find_messages", "mcp__mail-mcp__find_messages", "exec"]);
    expect(existsSync(path.join(s.dir, "a", ".cursor", "s"))).toBe(true);
    expect(importRollout(s, { file: "/nope", project: "a", session: "s" })).toBe(0);
  });
});

describe("the summary", () => {
  it("flags a question with no tool call, a wait, and a prompt with no answer", () => {
    const s = storeOf();
    appendEvents(s, [
      { project: "a", session: "s", cli: "claude", kind: "session", data: { phase: "start", transcript: "/t.jsonl" }, ts: "2026-11-19T10:00:00.000Z" },
      { project: "a", session: "s", cli: "claude", kind: "prompt", turn: "p1", data: { text: "ответь клиенту" }, ts: "2026-11-19T10:00:01.000Z" },
      { project: "a", session: "s", cli: "claude", kind: "answer", turn: "p1", data: { text: "Какому клиенту?" }, ts: "2026-11-19T10:00:05.000Z" },
      { project: "a", session: "s", cli: "claude", kind: "prompt", turn: "p2", data: { text: "Mark" }, ts: "2026-11-19T10:01:00.000Z" },
      { project: "a", session: "s", cli: "claude", kind: "tool_call", turn: "p2", data: { tool: "mcp__hub__focus" }, ts: "2026-11-19T10:01:01.000Z" },
      { project: "a", session: "s", cli: "claude", kind: "asked", turn: "p2", data: { why: "permission_prompt" }, ts: "2026-11-19T10:01:02.000Z" },
      { project: "a", session: "s", cli: "claude", kind: "answer", turn: "p2", data: { text: "Draft written." }, ts: "2026-11-19T10:01:30.000Z" },
      { project: "a", session: "s", cli: "claude", kind: "prompt", turn: "p3", data: { text: "and the next" }, ts: "2026-11-19T10:02:00.000Z" },
    ]);
    const [sum] = summarize(readEvents(s));
    expect(sum).toMatchObject({ session: "s", prompts: 3, answers: 2, toolCalls: 1, transcript: "/t.jsonl" });
    expect(sum?.turns.map((t) => t.flags)).toEqual([["asked_without_acting"], ["waited_on_owner"], ["no_answer"]]);
    expect(sum?.flags).toMatchObject({ asked_without_acting: 1, waited_on_owner: 1, no_answer: 1 });
  });
  it("a question ends a text even after markup", () => {
    expect(endsInQuestion("Which client do you mean?**")).toBe(true);
    expect(endsInQuestion("Done. Anything else? No.")).toBe(false);
  });
});

// P133 (P129 section 6): the friction counters the agent layer is measured by.
describe("friction", () => {
  const ev = (kind: LogEvent["kind"], turn: string, ts: string, data: Record<string, unknown> = {}): LogEvent => ({ v: 1, project: "a", session: "f", cli: "claude", kind, turn, data, ts });
  it("counts shell writers, evidence warnings on the owner's words, ToolSearch and AskUserQuestion turns, and the median turn", () => {
    const [sum] = summarize([
      ev("prompt", "p1", "2026-11-24T10:00:00.000Z", { text: "напиши ей стих" }),
      ev("tool_call", "p1", "2026-11-24T10:00:05.000Z", { tool: "ToolSearch", input: { query: "hub" } }),
      ev("tool_call", "p1", "2026-11-24T10:00:10.000Z", { tool: "mcp__hub__draft_write", input: { owner_request: "напиши ей стих" } }),
      ev("guard", "p1", "2026-11-24T10:00:10.000Z", { violations: ["read this client's thread and profile first: missing the thread"] }),
      ev("answer", "p1", "2026-11-24T10:00:20.000Z", { text: "Done." }),
      ev("prompt", "p2", "2026-11-24T10:01:00.000Z", { text: "record it" }),
      ev("tool_call", "p2", "2026-11-24T10:01:02.000Z", { tool: "Bash", input: { command: "pnpm hub record-draft --project a" } }),
      ev("tool_call", "p2", "2026-11-24T10:01:03.000Z", { tool: "AskUserQuestion", input: {} }),
      ev("guard", "p2", "2026-11-24T10:01:03.000Z", { violations: ["read this client's thread and profile first: missing the profile"] }),
      ev("answer", "p2", "2026-11-24T10:01:40.000Z", { text: "Which one?" }),
    ]);
    // The second turn's warning is not on the owner's words; its question came after a tool, so it did not ask instead of acting.
    expect(sum?.friction).toEqual({ shellWriters: 1, evidenceOnOwnerWords: 1, toolSearchTurns: 1, askUserTurns: 1, askedWithoutActing: 0, medianTurnSeconds: 30 });
    expect(frictionTotal(sum ? [sum, sum] : [])).toMatchObject({ shellWriters: 2, evidenceOnOwnerWords: 2, medianTurnSeconds: 30 });
  });
});

// P133 (P131 verdict 6): a Notion write is a line of the session log with the ids it touched.
describe("Notion writes in the session log", () => {
  const page = "1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b";
  it("a write names its action and the page ids of its input; a read and another tool carry nothing", () => {
    expect(notionWriteOf("mcp__notion__notion-update-page", { page_id: page, properties: { Status: "Won" } })).toEqual({ action: "notion-update-page", ids: ["1f2e3d4c5b6a47898a9b0c1d2e3f4a5b"] });
    expect(notionWriteOf("mcp__claude_ai_Notion__notion-create-pages", JSON.stringify({ parent: { data_source_id: page } }))?.ids).toEqual(["1f2e3d4c5b6a47898a9b0c1d2e3f4a5b"]);
    expect(notionWriteOf("mcp__notion__notion-fetch", { id: page })).toBeNull();
    expect(notionWriteOf("mcp__hub__draft_write", { page_id: page })).toBeNull();
  });
  it("the hook's tool call carries it, so hub log shows it", () => {
    const [call] = toolCallEvents({ session_id: "s", tool_name: "mcp__notion__notion-update-page", tool_input: { page_id: page } }, "claude", "a");
    expect(call?.data.notion).toEqual({ action: "notion-update-page", ids: ["1f2e3d4c5b6a47898a9b0c1d2e3f4a5b"] });
    const [read] = toolCallEvents({ session_id: "s", tool_name: "mcp__notion__notion-search", tool_input: { query: "x" } }, "claude", "a");
    expect(read?.data).not.toHaveProperty("notion");
  });
});
