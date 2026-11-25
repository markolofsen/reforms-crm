import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlm, defineTask, hasKey, keyFile, keySource, machineKeyFile, memoryLedger, noKeySentence, OPENROUTER_BASE_URL, openRouterTransport, readKey } from "../src/index";
import { kindOfStatus, retryAfterMs, usageOf } from "../src/transport/types";

// P78 L1, P144 W1: the OpenRouter request as the `openai` SDK sends it, against an injected fetch. The global fetch throws
// (test/no-network.ts), so these tests also prove the SDK never reaches the network on its own.
const KEY = "sk-or-v1-test-0123456789";
const Label = z.object({ label: z.enum(["lead", "spam"]) });
const task = defineTask({ name: "t", version: 1, preset: "cheap", schema: Label, system: "s", shape: { kind: "object" } });
const quick = { sleep: async () => {}, random: () => 0 };
const req = { model: "m", messages: [], schemaName: "n", schema: {}, maxTokens: 10, timeoutMs: 1000 };

type Seen = { url: string; body: string; headers: Headers };
const urlOf = (input: string | URL | Request): string => (input instanceof Request ? input.url : String(input));
function fetchOf(reply: (n: number) => Response, seen: Seen[]): typeof fetch {
  return async (input, init) => {
    seen.push({ url: urlOf(input), body: typeof init?.body === "string" ? init.body : "", headers: new Headers(init?.headers) });
    return reply(seen.length - 1);
  };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (content: string, cost = 0.0004) => json({ id: "gen-1", choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 9, cost, prompt_tokens_details: { cached_tokens: 100 } } });
const env = { ...process.env, OPENROUTER_API_KEY: KEY };

describe("the OpenRouter transport (openai SDK)", () => {
  it("the global fetch throws in these tests", () => {
    expect(() => globalThis.fetch("https://example.com")).toThrow(/never call the network/);
  });

  it("posts a strict json_schema with the provider field, temperature 0, the key only in the header; usage.cost is read from the raw body", async () => {
    const seen: Seen[] = [];
    const ledger = memoryLedger();
    const llm = createLlm({ ledger, env, fetch: fetchOf(() => ok('{"label":"lead"}'), seen), retry: quick });
    expect(llm.transport).toBe("openrouter");
    const r = await llm.run(task, { input: "i", project: "p" });
    expect(r.costMicroUsd).toBe(400);
    expect(seen[0]?.url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    const body: unknown = JSON.parse(seen[0]?.body ?? "null");
    expect(body).toMatchObject({
      model: "google/gemini-2.5-flash-lite",
      temperature: 0,
      max_tokens: 1024,
      provider: { require_parameters: true, data_collection: "deny" },
      response_format: { type: "json_schema", json_schema: { name: "t", strict: true, schema: { type: "object", required: ["label"], additionalProperties: false } } },
    });
    expect(seen[0]?.body).not.toContain(KEY);
    expect(seen[0]?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(seen[0]?.headers.get("x-title")).toBe("Hub");
    expect(ledger.rows[0]).toMatchObject({ tokensIn: 120, tokensOut: 9, tokensCached: 100, costMicroUsd: 400, generationId: "gen-1" });
  });

  it("maxRetries is 0: every request is one attempt and one ledger row, the ladder's own retries only", async () => {
    const seen: Seen[] = [];
    const ledger = memoryLedger();
    const llm = createLlm({ ledger, env, fetch: fetchOf((n) => (n < 2 ? json({ error: { message: "busy" } }, 503) : ok('{"label":"spam"}')), seen), retry: quick });
    expect((await llm.run(task, { input: "i", project: "p" })).value.label).toBe("spam");
    expect(seen).toHaveLength(3);
    expect(ledger.rows.map((x) => x.outcome)).toEqual(["upstream", "upstream", "ok"]);
  });

  it("maps statuses to kinds, reads Retry-After from the SDK's error, and never puts the key in an error", async () => {
    expect([401, 402, 403, 404, 408, 429, 500, 400].map(kindOfStatus)).toEqual(["auth", "credits", "content_filter", "no_endpoint", "timeout", "rate_limit", "upstream", "bad_request"]);
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(retryAfterMs(null)).toBeNull();
    const t = openRouterTransport({ key: KEY, fetch: async () => json({ error: { message: `bad key ${KEY}` } }, 401, { "retry-after": "2" }) });
    const e = await t.chat(req).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "auth", status: 401, retryAfterMs: 2000 });
    expect(String(e instanceof Error ? e.message : "")).toContain("bad key [key]");
    const busy = openRouterTransport({ key: KEY, fetch: async () => json({ error: { message: "slow down" } }, 429, { "retry-after": "7" }) });
    await expect(busy.chat(req)).rejects.toMatchObject({ code: "rate_limit", retryAfterMs: 7000 });
  });

  it("a fetch that throws is a network error with the key scrubbed; a 200 carrying an error object is the upstream's, its cost kept", async () => {
    const down = openRouterTransport({ key: KEY, fetch: async () => { throw new TypeError(`connect ECONNREFUSED ${KEY}`); } });
    const e = await down.chat(req).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "network" });
    expect(String(e instanceof Error ? e.message : "")).not.toContain(KEY);
    const mid = openRouterTransport({ key: KEY, fetch: async () => json({ error: { code: 502, message: "provider died" }, usage: { cost: 0.000003 } }) });
    await expect(mid.chat(req)).rejects.toMatchObject({ code: "upstream", usage: { costMicroUsd: 3 } });
    expect(usageOf({ usage: { cost: 0.0000014 } }).costMicroUsd).toBe(1);
  });

  it("a request that outlives its timeout is a timeout", async () => {
    const slow = openRouterTransport({
      key: KEY,
      fetch: (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    await expect(slow.chat({ ...req, timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("the key", () => {
  it("no key: a no_key refusal before any request, one ledger row, and the sentence names both files", async () => {
    const ledger = memoryLedger();
    const llm = createLlm({ ledger, retry: quick });
    expect(llm.transport).toBe("none");
    await expect(llm.run(task, { input: "i", project: "p" })).rejects.toMatchObject({ code: "no_key", message: noKeySentence() });
    expect(ledger.rows).toMatchObject([{ outcome: "no_key", model: null, costMicroUsd: 0 }]);
    expect(noKeySentence()).toContain(keyFile());
    expect(noKeySentence()).toContain(machineKeyFile() ?? "?");
  });

  it("OPENROUTER_API_KEY first, then the machine's file, then the instance's; a file readable by others is refused", () => {
    expect(readKey({ ...process.env, OPENROUTER_API_KEY: ` ${KEY} ` })).toBe(KEY);
    expect(keySource({ ...process.env, OPENROUTER_API_KEY: KEY })).toBe("env");
    expect(hasKey()).toBe(false);
    mkdirSync(dirname(keyFile()), { recursive: true });
    writeFileSync(keyFile(), `${KEY}\n`, { mode: 0o644 });
    chmodSync(keyFile(), 0o644);
    expect(readKey()).toBeNull();
    chmodSync(keyFile(), 0o600);
    expect(readKey()).toBe(KEY);
    expect(keySource()).toBe("instance");
    const machine = machineKeyFile();
    if (!machine) throw new Error("the test setup sets HUB_MACHINE_DIR");
    mkdirSync(dirname(machine), { recursive: true });
    writeFileSync(machine, "sk-or-v1-machine\n", { mode: 0o600 });
    expect(readKey()).toBe("sk-or-v1-machine");
    expect(keySource()).toBe("machine");
  });

  it("the machine's file is found only through the env handed in: no HOME and no HUB_MACHINE_DIR is no machine file", () => {
    expect(machineKeyFile({})).toBeNull();
    expect(machineKeyFile({ HOME: "/Users/x" })).toBe(join("/Users/x", ".config", "reforms-hub", "openrouter-key"));
  });

  it("HUB_LLM accepts only fake or nothing", () => {
    expect(() => createLlm({ ledger: memoryLedger(), env: { ...process.env, HUB_LLM: "real" } })).toThrow(/HUB_LLM/);
  });
});
