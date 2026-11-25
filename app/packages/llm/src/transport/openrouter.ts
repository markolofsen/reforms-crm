import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { isRecord, kindOfStatus, LlmError, retryAfterMs, usageOf, type ChatResponse, type Transport } from "./types";

/**
 * The one request the Hub makes to a model (decision 0051, amending 0039 point 1): OpenRouter's Chat Completions through the
 * official `openai` SDK, with a strict `json_schema`, `provider.require_parameters: true` (an endpoint that cannot enforce the
 * schema fails instead of answering free text) and `provider.data_collection: "deny"` (text never goes to a provider that trains
 * on it). The SDK is the typed wire only: `maxRetries: 0`, because the ladder retries and writes a ledger row per attempt, and
 * the cap is checked before each one. The key is used only by the SDK's Authorization header: it is scrubbed from every error.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenRouter's routing extension, typed beside the SDK's own body (no cast: a variable skips the excess-property check). */
type OpenRouterBody = ChatCompletionCreateParamsNonStreaming & { provider: { require_parameters: boolean; data_collection: "deny" | "allow" } };

export interface OpenRouterOptions {
  key: string;
  /** Tests inject one; the package's test setup makes the global one throw. */
  fetch?: typeof fetch;
  /** OpenRouter's app attribution header; no person or project is named. */
  title?: string;
}

const errorText = (body: unknown): string => {
  const e = isRecord(body) && isRecord(body.error) ? body.error : isRecord(body) ? body : null;
  return e && typeof e.message === "string" ? e.message.slice(0, 300) : "";
};

export function openRouterTransport(o: OpenRouterOptions): Transport {
  // Late-bound, so a test's throwing global still applies after the client is built.
  const doFetch: typeof fetch = o.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const client = new OpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey: o.key, defaultHeaders: { "X-Title": o.title ?? "Hub" }, fetch: doFetch, maxRetries: 0 });
  const scrub = (s: string) => (o.key.length > 0 ? s.split(o.key).join("[key]") : s);

  const failure = (model: string, e: unknown, timeoutMs: number): LlmError => {
    if (e instanceof LlmError) return e;
    if (e instanceof APIConnectionTimeoutError || e instanceof APIUserAbortError) return new LlmError("timeout", `${model}: no answer in ${timeoutMs} ms`);
    if (e instanceof APIConnectionError) return new LlmError("network", scrub(`${model}: ${e.message}`));
    if (e instanceof APIError && typeof e.status === "number") {
      const text = errorText(e.error);
      return new LlmError(kindOfStatus(e.status), scrub(`${model}: HTTP ${e.status}${text ? `: ${text}` : ""}`), { status: e.status, retryAfterMs: retryAfterMs(e.headers?.get("retry-after") ?? null) });
    }
    return new LlmError("network", scrub(`${model}: ${e instanceof Error ? e.message : "the transport failed"}`));
  };

  return {
    name: "openrouter",
    async chat(req): Promise<ChatResponse> {
      const body: OpenRouterBody = {
        model: req.model,
        messages: req.messages,
        response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
        max_tokens: req.maxTokens,
        temperature: 0,
        provider: { require_parameters: true, data_collection: "deny" },
      };
      let raw: unknown;
      try {
        raw = (await client.chat.completions.create(body, { timeout: req.timeoutMs }).withResponse()).data;
      } catch (e) {
        throw failure(req.model, e, req.timeoutMs);
      }
      // Read as the raw body: OpenRouter's `usage.cost` and a 200 that carries an `error` are not in the SDK's types.
      if (isRecord(raw) && isRecord(raw.error)) {
        const code = typeof raw.error.code === "number" ? raw.error.code : 502;
        throw new LlmError(kindOfStatus(code), scrub(`${req.model}: ${errorText(raw) || "upstream error"}`), { status: code, usage: usageOf(raw) });
      }
      const choice = isRecord(raw) && Array.isArray(raw.choices) && isRecord(raw.choices[0]) ? raw.choices[0] : null;
      if (!choice) throw new LlmError("upstream", `${req.model}: the answer has no choice`, { usage: usageOf(raw) });
      const message = isRecord(choice.message) ? choice.message : {};
      return {
        content: typeof message.content === "string" ? message.content : null,
        finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
        usage: usageOf(raw),
        generationId: isRecord(raw) && typeof raw.id === "string" ? raw.id : null,
      };
    },
  };
}
