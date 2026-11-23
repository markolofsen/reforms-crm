import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { importQueued, queuedPrompts } from "../src/claude-transcript";
import type { LogEvent } from "../src/event";
import { feedOf, tailEvents, type Placed } from "../src/feed";
import { labelOfTool } from "../src/feed-labels";
import { readEvents, type LogStore } from "../src/store";
import { summarize } from "../src/summary";

// P59 F1 (P73: the reply is the tones and the wait): the feed over fixture events shaped like the saas file of 2026-11-19 (a Claude turn that revised draft 1, a Codex
// turn imported at Stop with back-dated rows). The address and the mailRef of that file must never reach a reply.
const roots: string[] = [];
const storeOf = (): LogStore => {
  const root = mkdtempSync(path.join(tmpdir(), "hub-feed-"));
  roots.push(root);
  mkdirSync(path.join(root, "secrets"));
  return { dir: path.join(root, "log"), secrets: path.join(root, "secrets"), retentionDays: 90 };
};
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const NOW = new Date("2026-11-19T03:40:00.000Z");
const EMAIL = "markolofsen@gmail.com";
const MAILREF = "CALatTu3bWegGq2B8Pfx9L4N6o4LWQsZ9bnscjfXxE4B-4QA=2Q@mail.gmail.com";
const ev = (ts: string, kind: LogEvent["kind"], data: Record<string, unknown>, o: Partial<LogEvent> = {}): LogEvent => ({ v: 1, ts: `2026-11-19T${ts}Z`, project: "saas-support", session: "6a968d65-18b3-4d4f", cli: "claude", kind, turn: "3e457533", data, ...o });
const call = (ts: string, tool: string, input: unknown, corr: string, o: Partial<LogEvent> = {}) => ev(ts, "tool_call", { tool, input }, { corr, ...o });
const result = (ts: string, tool: string, output: unknown, corr: string, o: Partial<LogEvent> = {}) => ev(ts, "tool_result", { tool, output }, { corr, ...o });

/** Writes lines as the hooks do (append order is the array's) and reads the tail back. */
function write(events: LogEvent[], store = storeOf()): { store: LogStore; placed: Placed[] } {
  const dir = path.join(store.dir, "saas-support");
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, "2026-11-19.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return { store, placed: tailEvents(store, "saas-support", NOW) };
}

const claudeTurn = (): LogEvent[] => [
  ev("03:30:10.721", "prompt", { text: `answer ${EMAIL}?` }),
  ev("03:30:10.721", "focus", { line: `[Hub focus, data] draft 1 · Mark Effect <${EMAIL}> · Re: Hello` }),
  call("03:30:16.572", "ToolSearch", { query: "select:mcp__hub__focus" }, "t1"),
  result("03:30:17.911", "ToolSearch", "{\"matches\":[]}", "t1"),
  call("03:30:20.517", "mcp__hub__focus", {}, "t2"),
  result("03:30:21.698", "mcp__hub__focus", `{"state":"fresh","to":"${EMAIL}"}`, "t2"),
  call("03:30:26.511", "mcp__hub__draft_show", { draft: 1 }, "t3"),
  result("03:30:29.023", "mcp__hub__draft_show", `{"id":1,"to":"${EMAIL}","mailRef":"${MAILREF}"}`, "t3"),
  call("03:30:40.314", "mcp__mail-mcp__get_message_content", { account: "hello@reforms.ai", message_id: 138994 }, "t4"),
  result("03:31:09.171", "mcp__mail-mcp__get_message_content", { body: { sha256: "ca7d", chars: 12031 } }, "t4"),
  call("03:31:13.572", "mcp__hub__draft_write", { draft: 1, content: { body: { sha256: "230c", chars: 30 } } }, "t5"),
  ev("03:31:13.572", "guard", { mode: "warn", tool: "mcp__hub__draft_write", violations: [`read this client's thread first: ${EMAIL}`] }, { corr: "t5" }),
  result("03:31:20.345", "mcp__hub__draft_write", `{"draftId":139779,"thread":"${MAILREF}"}`, "t5"),
  call("03:31:26.118", "Bash", { command: `ls ${MAILREF}` }, "t6"),
  result("03:31:27.000", "Bash", "{\"stdout\":\"\"}", "t6"),
  ev("03:31:49.390", "answer", { text: "Готово. Черновик обновлён. Не отправлено." }),
];

describe("the feed (P59 F1)", () => {
  it("is the ended turns' tones and the wait only (P73: no rows, no labels, no cursor)", () => {
    const f = feedOf(write(claudeTurn()).placed, NOW);
    expect(Object.keys(f).sort()).toEqual(["turns", "waiting"]);
  });

  it("no input, output, text or command reaches the reply: the address and the mailRef are absent", () => {
    const { placed } = write([...claudeTurn(), ev("03:32:00.000", "asked", { why: "permission_request", tool: "Bash", input: { command: `curl ${EMAIL}` } }, { cli: "codex" })]);
    const text = JSON.stringify(feedOf(placed, NOW));
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(MAILREF);
    expect(text).not.toContain("ls ");
    expect(text).not.toMatch(/"(input|output|text|command)"/);
  });

  it("the turn that wrote and recorded a draft is ready once; a guard warning makes a turn a problem", () => {
    const ready = claudeTurn().filter((e) => e.kind !== "guard");
    expect(feedOf(write(ready).placed, NOW).turns).toEqual([{ id: "6a968d65-18b3-4d4f:3e457533", tone: "ready" }]);
    expect(feedOf(write(claudeTurn()).placed, NOW).turns).toEqual([{ id: "6a968d65-18b3-4d4f:3e457533", tone: "problem" }]);
  });

  it("a question, a permission prompt and an error each give their tone; an idle wait and a routine answer give none", () => {
    const t = (turn: string, ...events: LogEvent[]) => events.map((e) => ({ ...e, turn }));
    const { placed } = write([
      ...t("q", ev("04:00:00.000", "prompt", { text: "x" }), call("04:00:01.000", "mcp__hub__draft_show", { draft: 2 }, "a1"), ev("04:00:02.000", "answer", { text: "Formal or friendly?" })),
      ...t("p", ev("04:01:00.000", "prompt", { text: "x" }), ev("04:01:01.000", "asked", { why: "permission_prompt" })),
      ...t("e", ev("04:02:00.000", "prompt", { text: "x" }), ev("04:02:01.000", "error", { source: "stop_failure", message: "overloaded" })),
      ...t("r", ev("04:03:00.000", "prompt", { text: "x" }), ev("04:03:01.000", "answer", { text: "Draft 2 says hello." }), ev("04:04:01.000", "asked", { why: "idle_prompt" })),
    ]);
    const f = feedOf(placed, new Date("2026-11-19T04:10:00.000Z"));
    expect(f.turns.map((x) => `${x.id.split(":")[1]}:${x.tone}`)).toEqual(["q:attention", "p:attention", "e:problem"]);
    expect(f.waiting).toBe(false);
  });

  it("waits while the latest event of a session asks for him, under an hour ago; a prompt after it clears it", () => {
    const ask = [ev("05:00:00.000", "prompt", { text: "x" }, { turn: "w" }), ev("05:00:05.000", "answer", { text: "Which tone, formal or friendly?" }, { turn: "w" }), ev("05:01:00.000", "asked", { why: "idle_prompt" }, { turn: "w" })];
    const s = write(ask);
    expect(feedOf(s.placed, new Date("2026-11-19T05:10:00.000Z")).waiting).toBe(true);
    expect(feedOf(s.placed, new Date("2026-11-19T06:10:00.000Z")).waiting).toBe(false);
    const after = write([ev("05:02:00.000", "prompt", { text: "friendly" }, { turn: "w2" })], s.store);
    expect(feedOf(after.placed, new Date("2026-11-19T05:10:00.000Z")).waiting).toBe(false);
  });

  it("Codex rows written at Stop are back-dated: the turn is still new by its position", () => {
    const codex = (o: Partial<LogEvent>) => ({ cli: "codex" as const, session: "01a1f1db-aaaa", turn: "01a1f1db", ...o });
    const first = write([ev("03:31:08.833", "prompt", { text: "which draft?" }, codex({})), ev("03:31:13.572", "tool_call", { tool: "Bash", input: { command: "ls" } }, { corr: "c0" })]);
    const before = feedOf(first.placed, NOW);
    expect(before.turns).toEqual([]);
    const later = write([
      ev("03:31:11.308", "tool_call", { tool: "exec", input: "const r = await tools.mcp__hub__draft_show({draft: 4});", via: ["mcp__hub__draft_show"] }, codex({ corr: "x1" })),
      ev("03:31:11.528", "tool_result", { tool: "exec", output: "Script completed" }, codex({ corr: "x1" })),
      ev("03:31:12.000", "tool_call", { tool: "exec", input: "const r = await tools.mcp__hub__focus({});", via: ["mcp__hub__focus"] }, codex({ corr: "x2" })),
      ev("03:31:15.574", "answer", { text: "Draft 4, Re: Hello. Shall I revise it?" }, codex({})),
    ], first.store);
    const f = feedOf(later.placed, NOW);
    expect(f.turns).toEqual([{ id: "01a1f1db-aaaa:01a1f1db", tone: "attention" }]);
  });

  it("the tail reads the end of today's file and yesterday's when today's is short; a torn first line is dropped", () => {
    const store = storeOf();
    const dir = path.join(store.dir, "saas-support");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "2026-11-18.jsonl"), JSON.stringify(ev("23:59:00.000", "answer", { text: "late" }, { ts: "2026-11-18T23:59:00.000Z" })) + "\n");
    appendFileSync(path.join(dir, "2026-11-19.jsonl"), JSON.stringify(ev("00:01:00.000", "answer", { text: "early" })) + "\n");
    expect(tailEvents(store, "saas-support", NOW).map((p) => p.pos.slice(0, 10))).toEqual(["2026-11-18", "2026-11-19"]);
    const big = Array.from({ length: 400 }, (_, i) => JSON.stringify(ev("01:00:00.000", "answer", { text: `n${i} ${"x".repeat(200)}` })) + "\n").join("");
    appendFileSync(path.join(dir, "2026-11-19.jsonl"), big);
    const tail = tailEvents(store, "saas-support", NOW, 16_384);
    expect(tail.every((p) => p.pos.startsWith("2026-11-19"))).toBe(true);
    expect(tail.length).toBeGreaterThan(30);
    expect(tail.at(-1)?.e.data.text).toMatch(/^n399 /);
  });
});

describe("labels (table 4c)", () => {
  it("each tool of the table", () => {
    const l = (tool: string, input: unknown = {}, output?: unknown, done = true) => labelOfTool(tool, input, output, done)?.label ?? null;
    expect(l("ToolSearch")).toBeNull();
    expect(l("mcp__hub__focus")).toBeNull();
    expect(l("mcp__hub__draft_write", {})).toBe("writes a new draft");
    expect(l("mcp__hub__mail_list")).toBe("lists mail");
    expect(l("mcp__hub__project_show")).toBe("reads the project's settings");
    expect(l("mcp__hub__message_show", { inbound: 3 })).toBe("reads a client's message");
    expect(l("mcp__hub__client_show", { email: EMAIL })).toBe("reads a client");
    expect(l("mcp__mail-mcp__find_messages", { query: EMAIL })).toBe("searches mail");
    expect(l("mcp__mail-mcp__list_mailboxes")).toBe("looks at mail accounts");
    expect(l("mcp__mail-mcp__get_selected_messages")).toBe("mcp__mail-mcp__get_selected_messages");
    expect(l("mcp__hub__knowledge_search", { query: "visa" })).toBe("reads the knowledge base");
    expect(l("mcp__hub__knowledge_get", { path: "knowledge/files/a.md" })).toBe("reads the knowledge base");
    expect(l("mcp__notion__notion-fetch")).toBe("reads Notion");
    expect(l("mcp__notion__notion-update-page")).toBe("updates Notion");
    expect(l("mcp__claude_ai_Notion__notion-create-pages")).toBe("updates Notion");
    expect(l("Bash", { command: "hub doctor --help" })).toBe("runs a command");
    expect(l("Bash", { command: "ls ~/mail" })).toBe("runs a command");
    expect(l("Read", { file_path: "/x" })).toBe("reads a file");
    expect(l("Edit", { file_path: "/x" })).toBe("edits a file");
    expect(l("WebSearch", { query: "x" })).toBe("looks something up on the web");
    expect(l("exec", "text('hi')")).toBe("runs a script");
    expect(l("exec", "await tools.mcp__hub__focus({})")).toBe("runs a script");
    expect(labelOfTool("exec", "await tools.mcp__hub__focus({})", undefined, true, ["mcp__hub__focus"])).toBeNull();
    expect(labelOfTool("exec", { code: { sha256: "a", chars: 9 } }, undefined, true, ["mcp__hub__draft_write"])).toMatchObject({ label: "writes a new draft", ready: true });
    // P129 A3: a reply or a new thread is recorded by draft_write itself; its row links the draft its result recorded.
    expect(labelOfTool("mcp__hub__draft_write", { kind: "reply", content: { sha256: "a", chars: 9 } }, "{\"recorded\":true,\"record\":{\"draftId\":7,\"action\":\"created\"}}", true)).toMatchObject({ label: "writes draft 7", draft: 7, ready: true });
    expect(l("mcp__hub__client_record", { email: EMAIL })).toBe("records a client");
    expect(l("SomeNewTool")).toBe("SomeNewTool");
  });
});

describe("a queued owner message (P57 R0 gap)", () => {
  const line = (o: Record<string, unknown>) => JSON.stringify({ type: "attachment", timestamp: "2026-11-19T03:30:37.963Z", attachment: { type: "queued_command", prompt: "Ну, просто напиши «Привет, как дела?».", commandMode: "prompt", origin: { kind: "human" }, timestamp: "2026-11-19T03:30:37.963Z", ...o } });
  it("is read from the transcript as a prompt of the turn, once, and joins that turn in the summary", () => {
    expect(queuedPrompts([line({}), line({ origin: { kind: "system" } }), line({ commandMode: "bash" }), "{\"type\":\"user\"}"].join("\n"), { project: "p", session: "s", turn: "t" })).toHaveLength(1);
    const store = storeOf();
    const file = path.join(path.dirname(store.dir), "transcript.jsonl");
    appendFileSync(file, line({}) + "\n");
    expect(importQueued(store, { file, project: "p", session: "s", turn: "t" })).toBe(1);
    expect(importQueued(store, { file, project: "p", session: "s", turn: "t" })).toBe(0);
    const prompt = { v: 1 as const, ts: "2026-11-19T03:30:10.721Z", project: "p", session: "s", cli: "claude" as const, kind: "prompt" as const, turn: "t", data: { text: "ответ напиши на собщение?" } };
    const answer = { ...prompt, ts: "2026-11-19T03:31:49.390Z", kind: "answer" as const, data: { text: "Готово." } };
    const all = [...readEvents(store), prompt, answer].sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const [s] = summarize(all);
    expect(s?.prompts).toBe(1);
    expect(s?.turns).toHaveLength(1);
    expect(s?.turns[0]).toMatchObject({ prompt: "ответ напиши на собщение?", queued: ["Ну, просто напиши «Привет, как дела?»."], answer: "Готово.", flags: [] });
  });
});
