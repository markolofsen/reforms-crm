import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlm, defineTask, fakeTransport, LlmError, memoryLedger, PRESETS, type FakeScript } from "../src/index";

// P78 L1, P144 W1: the ladder of an object task on the fake transport. Nothing here reaches the network (test/no-network.ts).
const Label = z.object({ label: z.enum(["lead", "spam"]), note: z.string().optional() });
const labelTask = defineTask({ name: "t.label", version: 1, preset: "cheap", schema: Label, system: "Label it.", shape: { kind: "object" }, source: { kind: "test" } });
const plainTask = defineTask({ name: "t", version: 1, preset: "cheap", schema: Label, system: "s", shape: { kind: "object" } });
const config = () => join(process.env.HUB_HOME ?? "", "config", "config.json");
const setCap = (usd: number) => {
  mkdirSync(join(process.env.HUB_HOME ?? "", "config"), { recursive: true });
  writeFileSync(config(), JSON.stringify({ llm: { monthly_cap_usd: usd } }));
};
afterEach(() => rmSync(config(), { force: true }));

const quick = { sleep: async () => {}, random: () => 0 };
function make(script: FakeScript) {
  const ledger = memoryLedger();
  const transport = fakeTransport(script);
  const llm = createLlm({ ledger, transport, retry: quick });
  const call = () => llm.run(labelTask, { input: "hello", project: "p" });
  return { ledger, transport, llm, call };
}

describe("an object task", () => {
  it("returns the typed value, the model and the cost, and writes one ok row with counts only", async () => {
    const { ledger, transport, call } = make(() => ({ content: '{"label":"lead","note":null}', costUsd: 0.000812 }));
    const r = await call();
    expect(r).toEqual({ value: { label: "lead" }, model: PRESETS.cheap[0], attempts: 1, costMicroUsd: 812 });
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ project: "p", task: "t.label", model: PRESETS.cheap[0], attempt: 1, outcome: "ok", costMicroUsd: 812, sourceKind: "test", generationId: "fake-1" });
    expect(Object.keys(ledger.rows[0] ?? {})).not.toContain("content");
    const req = transport.requests[0];
    expect(req?.schemaName).toBe("t_label");
    expect(req?.messages).toEqual([{ role: "system", content: "Label it." }, { role: "user", content: "hello" }]);
  });

  it("re-asks once with zod's issues on a wrong shape, then succeeds; both attempts are rows", async () => {
    const { ledger, transport, call } = make((_r, n) => ({ content: n === 0 ? '{"label":"maybe"}' : '{"label":"spam"}' }));
    expect((await call()).value).toEqual({ label: "spam" });
    expect(ledger.rows.map((r) => r.outcome)).toEqual(["invalid", "ok"]);
    const second = transport.requests[1]?.messages ?? [];
    expect(second.at(-2)).toEqual({ role: "assistant", content: '{"label":"maybe"}' });
    expect(second.at(-1)?.content).toMatch(/^Your answer did not match the required JSON schema: label: /);
  });

  it("retries a cut answer once with twice the budget, never repairs it, then falls to the next model", async () => {
    const { ledger, transport, call } = make((req) => (req.model === PRESETS.cheap[0] ? { content: '{"label":"le', finishReason: "length" } : { content: '{"label":"lead"}' }));
    const r = await call();
    expect(r.model).toBe(PRESETS.cheap[1]);
    expect(transport.requests.map((q) => q.maxTokens)).toEqual([1024, 2048, 1024]);
    expect(ledger.rows.map((x) => `${x.model}:${x.outcome}`)).toEqual([`${PRESETS.cheap[0]}:truncated`, `${PRESETS.cheap[0]}:truncated`, `${PRESETS.cheap[1]}:ok`]);
  });

  it("retries a 429 on the same model honouring Retry-After, and a 5xx with jitter, then answers", async () => {
    const waits: number[] = [];
    const ledger = memoryLedger();
    const transport = fakeTransport((_r, n) => (n === 0 ? { error: "rate_limit", status: 429, retryAfterMs: 7000 } : n === 1 ? { error: "upstream", status: 503 } : { content: '{"label":"lead"}' }));
    const llm = createLlm({ ledger, transport, retry: { sleep: async (ms) => void waits.push(ms), random: () => 0.5 } });
    const r = await llm.run(plainTask, { input: "i", project: "p" });
    expect(r.attempts).toBe(3);
    expect(waits).toEqual([7000, 1000]);
    expect(ledger.rows.map((x) => x.outcome)).toEqual(["rate_limit", "upstream", "ok"]);
  });

  it("stops at once on the key's own failure (401, 402): the next model would fail the same way", async () => {
    const { ledger, call } = make(() => ({ error: "credits", status: 402 }));
    await expect(call()).rejects.toMatchObject({ code: "credits" });
    expect(ledger.rows).toHaveLength(1);
  });

  it("falls to the next model when no endpoint keeps the parameters (404 under require_parameters / data_collection deny)", async () => {
    const { call } = make((req) => (req.model === PRESETS.cheap[0] ? { error: "no_endpoint", status: 404 } : { content: '{"label":"lead"}' }));
    expect((await call()).model).toBe(PRESETS.cheap[1]);
  });

  it("throws the last error when every model fails, with every attempt in the ledger", async () => {
    const { ledger, call } = make(() => ({ content: "not json" }));
    const e = await call().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e).toMatchObject({ code: "invalid" });
    expect(ledger.rows.map((x) => x.outcome)).toEqual(["invalid", "invalid", "invalid", "invalid"]);
  });

  it("with the cap at 0 refuses before any request, writes a budget row and says how to fix it", async () => {
    setCap(0);
    const { ledger, transport, call } = make(() => ({ content: '{"label":"lead"}' }));
    await expect(call()).rejects.toMatchObject({ code: "budget", message: expect.stringMatching(/monthly_cap_usd/) });
    expect(transport.requests).toHaveLength(0);
    expect(ledger.rows).toMatchObject([{ outcome: "budget", costMicroUsd: 0 }]);
  });

  it("checks the cap before every attempt: a spend that reaches it stops the ladder", async () => {
    setCap(0.000001);
    const { transport, call } = make(() => ({ content: '{"label":"maybe"}', costUsd: 0.000002 }));
    await expect(call()).rejects.toMatchObject({ code: "budget" });
    expect(transport.requests).toHaveLength(1);
  });

  it("uses a preset's list from config.json in place of the core's", async () => {
    mkdirSync(join(process.env.HUB_HOME ?? "", "config"), { recursive: true });
    writeFileSync(config(), JSON.stringify({ llm: { presets: { cheap: ["vendor/other-model"] } } }));
    const { call } = make(() => ({ content: '{"label":"lead"}' }));
    expect((await call()).model).toBe("vendor/other-model");
  });

  it("adds a call's instructions after the fixed system text, never before it", async () => {
    const ledger = memoryLedger();
    const transport = fakeTransport(() => ({ content: '{"label":"lead"}' }));
    await createLlm({ ledger, transport, retry: quick }).run(plainTask, { input: "i", project: "p", instructions: "Reply language: Spanish." });
    expect(transport.requests[0]?.messages[0]).toEqual({ role: "system", content: "s\n\nReply language: Spanish." });
  });

  it("stops a task at its own monthly budget while the instance cap still has room", async () => {
    const ledger = memoryLedger();
    const budgeted = defineTask({ name: "t.watch", version: 1, preset: "window", schema: Label, system: "s", shape: { kind: "object" }, budget: { monthlyUsd: 0.00002 } });
    const transport = fakeTransport(() => ({ content: '{"label":"lead"}', costUsd: 0.00002 }));
    const llm = createLlm({ ledger, transport, retry: quick });
    await llm.run(budgeted, { input: "i", project: "p" });
    await expect(llm.run(budgeted, { input: "i", project: "p" })).rejects.toMatchObject({ code: "budget", message: expect.stringMatching(/t\.watch reached its monthly budget/) });
    expect(transport.requests).toHaveLength(1);
    // Another task is not limited by that budget.
    expect((await llm.run(plainTask, { input: "i", project: "p" })).value.label).toBe("lead");
    expect(await llm.monthCost({ task: "t.watch" })).toBe(20);
  });

  it("refuses a declaration that could not work, at definition", () => {
    expect(() => defineTask({ name: "Bad Name", version: 1, preset: "cheap", schema: Label, system: "s", shape: { kind: "object" } })).toThrow(/lower case/);
    expect(() => defineTask({ name: "t", version: 0, preset: "cheap", schema: Label, system: "s", shape: { kind: "object" } })).toThrow(/version/);
    expect(() => defineTask({ name: "t", version: 1, preset: "cheap", schema: z.object({ m: z.record(z.string(), z.number()) }), system: "s", shape: { kind: "object" } })).toThrow(/open record/);
    expect(() => defineTask({ name: "t", version: 1, preset: "cheap", schema: Label, system: "s", shape: { kind: "window", size: 10, overlap: 10, list: "x", index: "y" } })).toThrow(/overlap/);
    expect(() => defineTask({ name: "t", version: 1, preset: "cheap", schema: Label, system: "s", shape: { kind: "window", size: 10, overlap: 2, list: "label", index: "y" } })).toThrow(/not a list of objects/);
  });
});
