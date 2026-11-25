import { zodResponseFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlm, cutWindows, dedupeItems, defineTask, fakeTransport, memoryLedger, PRESETS, renderLine, strictJsonSchema, WINDOW_RULE, type ChatRequest, type WindowItem } from "../src/index";

// P144 W1: the window shape. Windows are cut and rendered here, answers point at messages by [n], ids are joined back in code,
// and an entry repeated in two windows' overlap is kept once. The fake is scripted; nothing reaches the network.
const Entry = z.object({ kind: z.enum(["ask", "other"]), speaker: z.number().int(), reactors: z.array(z.number().int()), quote: z.string() });
const Analysis = z.object({ topics: z.array(z.string()), entries: z.array(Entry) });
const task = defineTask({
  name: "t.window",
  version: 1,
  preset: "window",
  schema: Analysis,
  system: "Find the asks.",
  shape: { kind: "window", size: 10, overlap: 4, list: "entries", index: "speaker", refs: ["reactors"], key: "kind" },
  budget: { monthlyUsd: 2 },
});
const quick = { sleep: async () => {}, random: () => 0 };
const items = (n: number): WindowItem[] => Array.from({ length: n }, (_, k) => ({ id: `m${k}`, text: `message number ${k}`, author: k % 3 === 0 ? null : `@user${k % 3}` }));
const lines = (r: ChatRequest): string[] => (r.messages.at(-1)?.content ?? "").split("\n");

describe("the window shape", () => {
  it("cuts windows every size - overlap, keeps the last whole, and drops a short tail", () => {
    expect(cutWindows(100, 100, 20)).toEqual([{ from: 0, to: 99 }]);
    expect(cutWindows(20, 10, 4)).toEqual([{ from: 0, to: 9 }, { from: 6, to: 15 }, { from: 12, to: 19 }]);
    expect(cutWindows(5, 100, 20)).toEqual([]);
    expect(cutWindows(0, 10, 4)).toEqual([]);
  });

  it("renders [n] author: text on one line, cut, with character runs shortened", () => {
    expect(renderLine(3, { id: "x", text: "hi\nthere  🚀🚀🚀🚀🚀🚀 sooooooo", author: null }, 500)).toBe("[3] someone: hi there 🚀🚀🚀 sooo");
    expect(renderLine(1, { id: "x", text: "abcdef", author: "@a" }, 3)).toBe("[1] @a: abc");
    expect(dedupeItems([{ id: "1", text: "Buy now", author: null }, { id: "2", text: " buy NOW ", author: null }, { id: "3", text: "ok", author: null }]).map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("maps [n] to item ids, drops out-of-window indexes, and keeps an overlap repeat once", async () => {
    const transport = fakeTransport((req) => {
      const shown = lines(req);
      // Every window names its first message (n=1), and the message m6, which windows 1 and 2 share, as an ask.
      const at = shown.findIndex((l) => l.includes("message number 6 ") || l.endsWith("message number 6"));
      const entries = [
        { kind: "other", speaker: 1, reactors: [2, 1, 99], quote: "first" },
        { kind: "ask", speaker: at + 1, reactors: [], quote: "shared" },
        { kind: "ask", speaker: 42, reactors: [], quote: "outside" },
      ];
      return { content: JSON.stringify({ topics: ["t"], entries }) };
    });
    const ledger = memoryLedger();
    const llm = createLlm({ ledger, transport, retry: quick });
    const out = await llm.run(task, { project: "p", items: items(20) });

    expect(out.map((w) => [w.from, w.to, w.ok])).toEqual([[0, 9, true], [6, 15, true], [12, 19, true]]);
    expect(transport.requests[0]?.model).toBe(PRESETS.window[0]);
    expect(transport.requests[0]?.messages[0]?.content).toBe(`Find the asks.\n\n${WINDOW_RULE}`);
    expect(lines(transport.requests[0] ?? fail())[0]).toBe("[1] someone: message number 0");
    const [w1, w2, w3] = out;
    if (!w1?.ok || !w2?.ok || !w3?.ok) throw new Error("every window answers");
    expect(w1.entries.map((e) => [e.itemId, e.refs.reactors])).toEqual([["m0", ["m1"]], ["m6", []]]);
    // m6 again as an ask in window 2: the same speaker and key, so dropped; its first entry (m6, "other") is a new key.
    expect(w2.entries.map((e) => `${e.itemId}:${String(e.entry.kind)}`)).toEqual(["m6:other"]);
    expect(w3.entries.map((e) => e.itemId)).toEqual(["m12"]);
    expect(w1.value.topics).toEqual(["t"]);
    expect(ledger.rows.every((r) => r.task === "t.window")).toBe(true);
  });

  it("one failed window fails alone; dedupe drops repeated texts before windowing", async () => {
    const transport = fakeTransport((req) => (lines(req).some((l) => l.endsWith("message number 13")) ? { error: "content_filter", status: 403 } : { content: '{"topics":[],"entries":[]}' }));
    const llm = createLlm({ ledger: memoryLedger(), transport, retry: quick });
    const spam = [...items(20), ...Array.from({ length: 30 }, (_, k): WindowItem => ({ id: `s${k}`, text: "Join my channel", author: "@spam" }))];
    const out = await llm.run(task, { project: "p", items: spam, dedupe: true });
    expect(out).toHaveLength(3);
    expect(out.map((w) => w.ok)).toEqual([true, false, false]);
  });

  it("verdict 3: zodResponseFormat is not used, because it refuses .optional() and emits const, which Gemini does not list", () => {
    expect(() => zodResponseFormat(z.object({ a: z.string().optional() }), "x")).toThrow(/optional/);
    const sdk = JSON.stringify(zodResponseFormat(z.object({ k: z.literal("a"), n: z.number().min(1) }), "x").json_schema.schema);
    expect(sdk).toContain('"const"');
    const ours = JSON.stringify(strictJsonSchema(z.object({ k: z.literal("a"), n: z.number().min(1), a: z.string().optional() })));
    expect(ours).not.toContain('"const"');
    expect(ours).not.toContain('"minimum"');
  });
});

function fail(): never {
  throw new Error("no request was sent");
}
