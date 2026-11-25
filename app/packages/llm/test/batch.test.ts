import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlm, defineTask, fakeTransport, memoryLedger, type ChatRequest } from "../src/index";

// P78 acceptance (a batch task since P144 W1): a batch over 20 items returns 20 typed results, one deliberately broken item failing alone.
const Item = z.object({ topic: z.enum(["price", "visit", "other"]), urgent: z.boolean() });
const topics = defineTask({ name: "t.topics", version: 1, preset: "cheap", schema: Item, system: "Tag each message.", shape: { kind: "batch" } });
const small = defineTask({ name: "t", version: 1, preset: "cheap", schema: Item, system: "s", shape: { kind: "batch", perCall: 5, concurrency: 2 } });
const plain = defineTask({ name: "t", version: 1, preset: "cheap", schema: Item, system: "s", shape: { kind: "batch" } });
const quick = { sleep: async () => {}, random: () => 0 };
const sent = (req: ChatRequest): number[] => {
  let json: unknown = null;
  try {
    json = JSON.parse(req.messages.at(-1)?.content ?? "null");
  } catch {
    json = null;
  }
  const parsed = z.object({ items: z.array(z.object({ i: z.number() })) }).safeParse(json);
  return parsed.success ? parsed.data.items.map((x) => x.i) : [];
};

describe("a batch task", () => {
  it("20 items, one request, 20 results in order; the broken one is asked again alone and fails alone", async () => {
    const ledger = memoryLedger();
    const transport = fakeTransport((req) => {
      const ids = sent(req);
      if (ids.length === 0) return { content: '{"topic":"weather","urgent":false}' }; // item 7 alone: still wrong
      return { content: JSON.stringify({ items: ids.map((i) => ({ i, value: i === 7 ? { topic: "weather", urgent: false } : { topic: "price", urgent: i % 2 === 0 } })) }) };
    });
    const llm = createLlm({ ledger, transport, retry: quick });
    const items = Array.from({ length: 20 }, (_, k) => `message ${k}`);
    const out = await llm.run(topics, { items, project: "p" });

    expect(out).toHaveLength(20);
    expect(out.map((r) => r.i)).toEqual(items.map((_, k) => k));
    expect(out.filter((r) => r.ok)).toHaveLength(19);
    const bad = out[7];
    expect(bad?.ok).toBe(false);
    if (bad && !bad.ok) expect(bad.error.code).toBe("invalid");
    const good = out[4];
    expect(good?.ok && good.value).toEqual({ topic: "price", urgent: true });
    // One request for the chunk; item 7 alone then takes the whole ladder (re-ask, next model, re-ask): four more.
    const first = transport.requests[0];
    expect(first && sent(first)).toHaveLength(20);
    expect(transport.requests).toHaveLength(5);
    expect(transport.requests[1]?.messages.at(-1)?.content).toBe('"message 7"');
    expect(ledger.rows.map((r) => r.outcome)).toEqual(["ok", "invalid", "invalid", "invalid", "invalid"]);
  });

  it("an index the model left out or answered twice is asked again alone; the rest stand", async () => {
    const transport = fakeTransport((req) => {
      const ids = sent(req);
      if (ids.length === 0) return { content: '{"topic":"visit","urgent":true}' };
      return { content: JSON.stringify({ items: [...ids.filter((i) => i !== 1).map((i) => ({ i, value: { topic: "other", urgent: false } })), { i: 2, value: { topic: "price", urgent: false } }] }) };
    });
    const llm = createLlm({ ledger: memoryLedger(), transport, retry: quick });
    const out = await llm.run(plain, { items: ["a", "b", "c", "d"], project: "p" });
    expect(out.map((r) => r.ok && r.value.topic)).toEqual(["other", "visit", "visit", "other"]);
  });

  it("splits into chunks of perCall with the given concurrency, and a failed chunk fails only its own items", async () => {
    let inFlight = 0;
    let peak = 0;
    const transport = fakeTransport(async (req) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      const ids = sent(req);
      if (ids.includes(10)) return { error: "content_filter", status: 403 };
      return { content: JSON.stringify({ items: ids.map((i) => ({ i, value: { topic: "other", urgent: false } })) }) };
    });
    const llm = createLlm({ ledger: memoryLedger(), transport, retry: quick });
    const out = await llm.run(small, { items: Array.from({ length: 25 }, (_, k) => k), project: "p" });
    expect(peak).toBeLessThanOrEqual(2);
    expect(out.filter((r) => !r.ok).map((r) => r.i)).toEqual([10, 11, 12, 13, 14]);
  });

  it("the unscripted fake answers a batch with one item per index (the path HUB_LLM=fake runs)", async () => {
    const llm = createLlm({ ledger: memoryLedger(), env: { ...process.env, HUB_LLM: "fake" }, retry: quick });
    expect(llm.transport).toBe("fake");
    const out = await llm.run(plain, { items: ["x", "y", "z"], project: "p" });
    expect(out.map((r) => r.ok && r.value)).toEqual([{ topic: "price", urgent: false }, { topic: "price", urgent: false }, { topic: "price", urgent: false }]);
  });
});
