import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openOwnFile } from "@hub/db";
import { analyseGroup, analysisDue } from "../src/analyse/job";
import { parseWatch, watchGroups, type WatchConfig } from "../src/config";
import { createWatcher, type PublicReader } from "../src/reader/poller";
import { createWatchQueue } from "../src/reader/queue";
import { openWatchStore, type NewMessage, type WatchStore } from "../src/store/repo";
import { acmeLens, answer, fakeLlm, tempStore } from "./support";

const at = new Date("2026-11-27T00:00:00.000Z");
const legacy = "| lens | watch-acme |\n| on | yes |\n## Groups\n- @garden_talk\n";
const direction = (id: string, groups = ["garden_talk", "tools_chat"]) => `## Direction ${id}\n| lens | watch-tools |\n| on | yes |\n| analysis_minutes | 60 |\n### Groups\n${groups.map((g) => `- @${g}`).join("\n")}\n`;
const messages = (n: number): NewMessage[] => Array.from({ length: n }, (_, i) => ({ messageId: i + 1, senderId: "7", senderHandle: null, text: `message ${i + 1}`, sentAt: at.toISOString() }));

function record(store: WatchStore, group: string, id = 1) {
  const key = `${group}:${id}`;
  store.recordWindow({ windowKey: key, groupUsername: group, firstMessageId: id, lastMessageId: id, messages: 1, taskVersion: 1, model: "fake", costMicroUsd: 10, topics: [group], mood: "calm", firstAt: at.toISOString(), lastAt: at.toISOString() },
    [{ groupUsername: group, messageId: id, trigger: "broken_tool", triggerOther: "", intensity: 4, quote: "Broken", authorId: "7", authorHandle: "@author", reactorHandles: [], context: "", why: "", windowKey: key, at: at.toISOString() }], at);
}

describe("named watch directions", () => {
  it("keeps legacy settings intact and applies one union cap across named directions", () => {
    const old = parseWatch(legacy);
    expect(old).toEqual({ state: "ok", config: { lens: "watch-acme", on: true, account: "default", pollMinutes: 5, groups: ["garden_talk"] } });
    const r = parseWatch(legacy + direction("tools"));
    expect(r.state).toBe("ok");
    if (r.state !== "ok") throw new Error("invalid fixture");
    expect(watchGroups(r.config)).toEqual(["garden_talk", "tools_chat"]);
    expect(r.config.directions?.[0]).toMatchObject({ id: "tools", analysisMinutes: 60 });
    expect(parseWatch(legacy + direction("default")).state).toBe("invalid");
    expect(parseWatch(legacy + direction("tools") + direction("tools")).state).toBe("invalid");
    expect(parseWatch(legacy + direction("tools", Array.from({ length: 15 }, (_, i) => `group_${i}`))).state).toBe("invalid");
    expect(parseWatch(legacy + direction("tools").replace("| on | yes |", "| account | 12345 |")).state).toBe("invalid");
  });

  it("uses an hour for a quiet direction and preserves the legacy six-hour default", () => {
    const g = { newSinceAnalysis: 20, addedAt: "2026-11-26T22:59:00Z", lastAnalysisAt: null };
    expect(analysisDue(g, at)).toBe(false);
    expect(analysisDue(g, at, 60 * 60_000)).toBe(true);
  });

  it("opts into a bounded larger source list without changing the legacy cap", () => {
    const many = direction("tools", Array.from({ length: 29 }, (_, i) => `tools_${i}`));
    expect(parseWatch(legacy + many).state).toBe("invalid");
    expect(parseWatch(legacy.replace("## Groups", "| source_cap | 30 |\n## Groups") + many).state).toBe("ok");
    expect(parseWatch(legacy.replace("## Groups", "| source_cap | 61 |\n## Groups")).state).toBe("invalid");
  });

  it("keeps source rows shared, analysis separate, and filters every read by current sources", () => {
    const store = tempStore();
    store.ensureGroups(["garden_talk", "old_group"], at);
    store.addMessages("garden_talk", messages(20), at);
    store.addMessages("old_group", messages(20), at);
    const tools = store.forDirection("tools");
    record(store, "garden_talk");
    record(store, "old_group");
    record(tools, "garden_talk");
    expect(store.moments({})).toHaveLength(2);
    expect(tools.moments({})).toHaveLength(1);
    expect(tools.messagesOf("garden_talk")).toHaveLength(20);
    expect(store.forDirection("other").moments({})).toEqual([]);
    const scoped = store.forGroups(["garden_talk"]);
    expect(scoped.triggers("")[0]?.moments).toBe(1);
    expect(scoped.topics("").map((t) => t.topic)).toEqual(["garden_talk"]);
    expect(scoped.people("")[0]?.groups).toEqual(["garden_talk"]);
    expect(scoped.trend("")[0]?.moments).toBe(1);
    expect(scoped.moments({ limit: 1 })[0]?.groupUsername).toBe("garden_talk");
    expect(scoped.groupStats("")).toHaveLength(1);
    expect(store.forGroups([]).triggers("")).toEqual([]);
    tools.close();
    expect(store.messagesOf("garden_talk")).toHaveLength(20);
    store.close();
  });

  it("fetches a shared group once and advances over media-only pages", async () => {
    const store = tempStore();
    const lens = await acmeLens();
    const { llm } = fakeLlm(() => ({ content: answer([]) }));
    let time = at.getTime();
    const calls: number[] = [];
    const reader: PublicReader = {
      resolve: async () => ({ peerId: "-100123", title: "Garden" }),
      history: async (_peer, q) => { calls.push(q.minId); return { ok: true, messages: q.minId === 0
        ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1, senderId: null, senderHandle: null, text: "", sentAt: at.toISOString() }))
        : [{ id: 101, senderId: "7", senderHandle: null, text: "a question", sentAt: at.toISOString(), replyToMessageId: 99, threadId: 9 }] }; },
      join: async () => "joined",
    };
    const cfg: WatchConfig = { lens: "watch-acme", account: "default", on: true, pollMinutes: 5, groups: ["garden_talk"], directions: [{ id: "tools", title: null, lens: "watch-tools", on: true, groups: ["garden_talk"] }] };
    const queue = createWatchQueue({ owner: { busy: () => false }, clock: { now: () => time, random: () => 0, sleep: async (ms) => { time += ms; } } });
    const watcher = createWatcher({ project: "acme", config: cfg, store, lens, llm, queue, now: () => new Date(time), reader: () => reader,
      analyses: () => [{ direction: "default", groups: cfg.groups, store, lens }, { direction: "tools", groups: cfg.groups, store: store.forDirection("tools"), lens }] });
    await watcher.tick();
    expect(calls).toEqual([0]);
    expect(store.group("garden_talk")?.lastMessageId).toBe(100);
    time += 5 * 60_000;
    await watcher.tick();
    expect(calls).toEqual([0, 100]);
    expect(store.messageContext("garden_talk", 101)[0]).toMatchObject({ messageId: 101, replyToMessageId: 99, threadId: 9 });
    expect(store.messageContext("garden_talk", 999)).toEqual([]);
    store.close();
  });

  it("marks a repeated tail processed after a complete successful analysis", async () => {
    const store = tempStore();
    store.ensureGroups(["garden_talk"], at);
    store.addMessages("garden_talk", messages(120).map((m) => ({ ...m, text: m.messageId <= 20 ? m.text : "message 1" })), at);
    const { llm, transport } = fakeLlm(() => ({ content: answer([]) }));
    const lens = await acmeLens();
    await analyseGroup({ store, lens, llm, now: () => at }, "garden_talk");
    expect(store.windowsLastMessage("garden_talk")).toBe(120);
    expect(store.analysisGroups()[0]?.newSinceAnalysis).toBe(0);
    await analyseGroup({ store, lens, llm, now: () => at }, "garden_talk");
    expect(transport.requests).toHaveLength(1);
    expect(store.forDirection("tools").analysisGroups()[0]?.newSinceAnalysis).toBe(120);
    store.close();
  });

  it("keeps readable sources progressing when more than a poll batch is blocked", async () => {
    const store = tempStore();
    const blocked = Array.from({ length: 10 }, (_, i) => `blocked_${i}`);
    const groups = [...blocked, "working_chat"];
    store.ensureGroups(groups, at);
    for (const username of blocked) store.setGroup(username, { access: "join_required" });
    let pulls = 0;
    const reader: PublicReader = { resolve: async () => ({ peerId: "-1001", title: "Working" }), history: async () => { pulls += 1; return { ok: true, messages: [] }; }, join: async () => "joined" };
    const { llm } = fakeLlm(() => ({ content: answer([]) }));
    const watcher = createWatcher({ project: "acme", config: { lens: "watch-acme", on: true, account: "default", pollMinutes: 5, groups }, store, llm, lens: await acmeLens(), reader: () => reader,
      queue: createWatchQueue({ owner: { busy: () => false }, clock: { now: () => at.getTime(), sleep: async () => {}, random: () => 0 } }), now: () => at });
    await watcher.tick();
    expect(pulls).toBe(1);
    expect(store.group("working_chat")?.lastPolledAt).toBe(at.toISOString());
    store.close();
  });

  it("retries a failed window instead of advancing past a later successful one", async () => {
    const store = tempStore();
    store.ensureGroups(["garden_talk"], at);
    store.addMessages("garden_talk", messages(250), at);
    const failing = fakeLlm((req) => ({ content: req.messages.some((m) => m.content.includes("[1] user7: message 81\n")) ? "not json" : answer([]) }));
    const lens = await acmeLens();
    const first = await analyseGroup({ store, lens, llm: failing.llm, now: () => at }, "garden_talk");
    expect(first.failedWindows).toBe(1);
    expect(store.windowsLastMessage("garden_talk")).toBe(100);
    expect(store.analysisGroups()[0]?.newSinceAnalysis).toBe(150);
    expect(store.windowCount("")).toBe(1);
    const retry = fakeLlm(() => ({ content: answer([]) }));
    await analyseGroup({ store, lens, llm: retry.llm, now: () => at }, "garden_talk");
    expect(retry.transport.requests[0]?.messages.some((m) => m.content.includes("[1] user7: message 81\n"))).toBe(true);
    expect(store.windowsLastMessage("garden_talk")).toBe(250);
    expect(store.analysisGroups()[0]?.newSinceAnalysis).toBe(0);
    store.close();
  });

  it("migrates legacy windows and moments without changing their evidence or duplicating sources", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-migration-"));
    const migrations = join(root, "old");
    cpSync(resolve(import.meta.dirname, "../migrations"), migrations, { recursive: true, filter: (source) => !source.endsWith("0003_directions_and_reply_context.sql") && !source.endsWith("0004_memberships.sql") });
    const file = join(root, "watch.db");
    const old = openOwnFile(file, { migrationsFolder: migrations, label: "watch-test" });
    old.client.prepare("INSERT INTO groups(project,username,added_at) VALUES ('acme','garden_talk',?)").run(at.toISOString());
    old.client.prepare("INSERT INTO messages(project,group_username,message_id,text,sent_at,stored_at) VALUES ('acme','garden_talk',1,'hello',?,?)").run(at.toISOString(), at.toISOString());
    old.client.prepare("INSERT INTO windows(project,window_key,group_username,first_message_id,last_message_id,messages,task_version,model,cost_micro_usd,first_at,last_at,analysed_at) VALUES ('acme','w','garden_talk',1,1,1,2,'fake',123,?,?,?)").run(at.toISOString(), at.toISOString(), at.toISOString());
    old.client.prepare("INSERT INTO moments(project,group_username,message_id,trigger,intensity,quote,window_key,at,blanked) VALUES ('acme','garden_talk',1,'broken_tool',4,'source','w',?,1)").run(at.toISOString());
    old.close();
    const next = openWatchStore(file, { project: "acme", migrate: true });
    expect(next.moments({})).toMatchObject([{ quote: "source", intensity: 4, authorId: null }]);
    expect(next.windowCount("")).toBe(1);
    expect(next.spend("")).toBe(123);
    expect(next.messagesOf("garden_talk")).toMatchObject([{ messageId: 1, text: "hello", replyToMessageId: null }]);
    expect(next.forDirection("tools").moments({})).toEqual([]);
    expect(next.forDirection("tools").messagesOf("garden_talk")).toHaveLength(1);
    next.close();
  });
});
