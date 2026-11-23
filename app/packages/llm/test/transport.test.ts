import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlm, hasKey, keyFile, memoryLedger, noKeySentence, OPENROUTER_URL, openRouterTransport, readKey } from "../src/index";
import { kindOfStatus, retryAfterMs, usageOf } from "../src/transport";

// P78 L1: the OpenRouter request as it would leave, built against an injected fetch. The global fetch throws (test/no-network.ts).
const KEY = "sk-or-v1-test-0123456789";
const Label = z.object({ label: z.enum(["lead", "spam"]) });
const quick = { sleep: async () => {}, random: () => 0 };

type Seen = { url: string; init: RequestInit | undefined };
function fetchOf(reply: (n: number) => Response, seen: Seen[]): typeof fetch {
  return async (input, init) => {
    seen.push({ url: String(input), init });
    return reply(seen.length - 1);
  };
}
const ok = (content: string, cost = 0.0004) => new Response(JSON.stringify({ id: "gen-1", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 9, cost, prompt_tokens_details: { cached_tokens: 100 } } }), { status: 200 });

describe("the OpenRouter transport", () => {
  it("the global fetch throws in these tests", () => {
    expect(() => globalThis.fetch("https://example.com")).toThrow(/never call the network/);
  });

  it("posts a strict json_schema with require_parameters and data_collection deny, temperature 0, the key only in the header", async () => {
    const seen: Seen[] = [];
    const ledger = memoryLedger();
    const llm = createLlm({ ledger, env: { ...process.env, OPENROUTER_API_KEY: KEY }, fetch: fetchOf(() => ok('{"label":"lead"}'), seen), retry: quick });
    expect(llm.transport).toBe("openrouter");
    const r = await llm.object({ task: "t", schema: Label, system: "s", input: "i", project: "p" });
    expect(r.costMicroUsd).toBe(400);
    expect(seen[0]?.url).toBe(OPENROUTER_URL);
    const body: unknown = JSON.parse(String(seen[0]?.init?.body));
    expect(body).toMatchObject({
      model: "google/gemini-2.5-flash-lite",
      temperature: 0,
      max_tokens: 1024,
      provider: { require_parameters: true, data_collection: "deny" },
      response_format: { type: "json_schema", json_schema: { name: "t", strict: true, schema: { type: "object", required: ["label"], additionalProperties: false } } },
    });
    expect(String(seen[0]?.init?.body)).not.toContain(KEY);
    expect(new Headers(seen[0]?.init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(ledger.rows[0]).toMatchObject({ tokensIn: 120, tokensOut: 9, tokensCached: 100, costMicroUsd: 400, generationId: "gen-1" });
  });

  it("maps statuses to kinds, reads Retry-After, and never puts the key in an error", async () => {
    expect([401, 402, 403, 404, 408, 429, 500, 400].map(kindOfStatus)).toEqual(["auth", "credits", "content_filter", "no_endpoint", "timeout", "rate_limit", "upstream", "bad_request"]);
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(retryAfterMs(null)).toBeNull();
    const t = openRouterTransport({ key: KEY, fetch: async () => new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status: 401, headers: { "retry-after": "2" } }) });
    const e = await t.chat({ model: "m", messages: [], schemaName: "n", schema: {}, maxTokens: 10, timeoutMs: 1000 }).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "auth", status: 401, retryAfterMs: 2000 });
    expect(String(e instanceof Error ? e.message : "")).not.toContain(KEY);
  });

  it("a fetch that throws is a network error; a 200 carrying an error object is the upstream's", async () => {
    const down = openRouterTransport({ key: KEY, fetch: async () => { throw new TypeError(`connect ECONNREFUSED ${KEY}`); } });
    const e = await down.chat({ model: "m", messages: [], schemaName: "n", schema: {}, maxTokens: 10, timeoutMs: 1000 }).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "network" });
    expect(String(e instanceof Error ? e.message : "")).not.toContain(KEY);
    const mid = openRouterTransport({ key: KEY, fetch: async () => new Response(JSON.stringify({ error: { code: 502, message: "provider died" } }), { status: 200 }) });
    await expect(mid.chat({ model: "m", messages: [], schemaName: "n", schema: {}, maxTokens: 10, timeoutMs: 1000 })).rejects.toMatchObject({ code: "upstream" });
    expect(usageOf({ usage: { cost: 0.0000014 } }).costMicroUsd).toBe(1);
  });
});

describe("the key", () => {
  it("no key: a no_key refusal before any request, one ledger row, and the sentence names the file", async () => {
    const ledger = memoryLedger();
    const llm = createLlm({ ledger, retry: quick });
    expect(llm.transport).toBe("none");
    await expect(llm.object({ task: "t", schema: Label, system: "s", input: "i", project: "p" })).rejects.toMatchObject({ code: "no_key", message: noKeySentence() });
    expect(ledger.rows).toMatchObject([{ outcome: "no_key", model: null, costMicroUsd: 0 }]);
    expect(noKeySentence()).toContain(keyFile());
  });

  it("OPENROUTER_API_KEY first, then the key file; a file readable by others is refused", () => {
    expect(readKey({ ...process.env, OPENROUTER_API_KEY: ` ${KEY} ` })).toBe(KEY);
    expect(hasKey()).toBe(false);
    mkdirSync(dirname(keyFile()), { recursive: true });
    writeFileSync(keyFile(), `${KEY}\n`, { mode: 0o644 });
    chmodSync(keyFile(), 0o644);
    expect(readKey()).toBeNull();
    chmodSync(keyFile(), 0o600);
    expect(readKey()).toBe(KEY);
  });

  it("HUB_LLM accepts only fake or nothing", () => {
    expect(() => createLlm({ ledger: memoryLedger(), env: { ...process.env, HUB_LLM: "real" } })).toThrow(/HUB_LLM/);
  });
});
