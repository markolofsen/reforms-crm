import { HubError, type ErrorKind } from "@hub/config/errors";
import type { LlmOutcome } from "@hub/config/llm";

/**
 * The one request the Hub makes to a model (decision 0039 point 1): a plain `fetch` POST to OpenRouter's Chat Completions with a
 * strict `json_schema`, `provider.require_parameters: true` (an endpoint that cannot enforce the schema fails instead of silently
 * answering free text) and `provider.data_collection: "deny"` (client text never goes to a provider that trains on it). No SDK.
 * The key is used only in the Authorization header: it is never in an error, a log line or the ledger.
 */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type LlmErrorKind = Exclude<LlmOutcome, "ok">;
export type Message = { role: "system" | "user" | "assistant"; content: string };

export interface ChatRequest {
  model: string;
  messages: Message[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

export interface Usage { tokensIn: number; tokensOut: number; tokensCached: number; costMicroUsd: number }

export interface ChatResponse {
  content: string | null;
  finishReason: string | null;
  usage: Usage;
  generationId: string | null;
}

/** A model call. Throws `LlmError` for every failure, never anything else. */
export interface Transport {
  readonly name: "openrouter" | "fake";
  chat(req: ChatRequest): Promise<ChatResponse>;
}

const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set(["timeout", "network", "rate_limit", "upstream"]);
/** The key itself is wrong or out of money: no other model can help. */
const KEY_FATAL: ReadonlySet<LlmErrorKind> = new Set(["auth", "credits", "budget", "no_key"]);

/** The Hub's kind of each outcome (P126 E1): an unusable or failed answer is the upstream's, a full queue is busy, the key or the cap makes the model unavailable. */
const KIND_OF: Readonly<Record<LlmErrorKind, ErrorKind>> = { invalid: "upstream", truncated: "upstream", timeout: "upstream", network: "upstream", upstream: "upstream", bad_request: "upstream", no_endpoint: "upstream", content_filter: "upstream", rate_limit: "busy", auth: "unavailable", credits: "unavailable", budget: "unavailable", no_key: "unavailable" };

/**
 * Every failure of `@hub/llm`, with a `code` callers branch on (never on the text): the outcome the ledger records. It is a
 * `HubError` (P126 E1), so a surface that reaches one unwrapped maps it by `kind` like any other refusal.
 */
export class LlmError extends HubError {
  declare readonly code: LlmErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  /** Spend the failed attempt was billed (a truncated or invalid answer still costs); written to the ledger. */
  readonly usage: Usage | null;
  constructor(code: LlmErrorKind, message: string, o: { status?: number | null; retryAfterMs?: number | null; usage?: Usage | null } = {}) {
    super(KIND_OF[code], code, message);
    this.name = "LlmError";
    this.status = o.status ?? null;
    this.retryAfterMs = o.retryAfterMs ?? null;
    this.usage = o.usage ?? null;
  }
  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
  /** True when the next model of the preset would fail the same way (the key, the cap): stop the ladder. */
  get stopsChain(): boolean {
    return KEY_FATAL.has(this.code);
  }
}

export const ZERO_USAGE: Usage = { tokensIn: 0, tokensOut: 0, tokensCached: 0, costMicroUsd: 0 };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** OpenRouter's `usage` (`cost` in credits = USD) as integers; the cost as whole micro-dollars. */
export function usageOf(body: unknown): Usage {
  const u = isRecord(body) && isRecord(body.usage) ? body.usage : {};
  const details = isRecord(u.prompt_tokens_details) ? u.prompt_tokens_details : {};
  return { tokensIn: Math.round(num(u.prompt_tokens)), tokensOut: Math.round(num(u.completion_tokens)), tokensCached: Math.round(num(details.cached_tokens)), costMicroUsd: Math.round(num(u.cost) * 1e6) };
}

/** `Retry-After` as milliseconds: seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** The HTTP status as a kind. 404 is OpenRouter's "no endpoint supports these parameters" (require_parameters, data_collection). */
export function kindOfStatus(status: number): LlmErrorKind {
  if (status === 401) return "auth";
  if (status === 402) return "credits";
  if (status === 403) return "content_filter";
  if (status === 404) return "no_endpoint";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "upstream";
  return "bad_request";
}

const errorText = (body: unknown): string => {
  const e = isRecord(body) && isRecord(body.error) ? body.error : null;
  return e && typeof e.message === "string" ? e.message.slice(0, 300) : "";
};

export interface OpenRouterOptions {
  key: string;
  /** Tests inject one; the package's test setup makes the global one throw. */
  fetch?: typeof fetch;
  /** OpenRouter's app attribution headers; no person or project is named. */
  title?: string;
}

export function openRouterTransport(o: OpenRouterOptions): Transport {
  const doFetch = o.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const scrub = (s: string) => (o.key.length > 0 ? s.split(o.key).join("[key]") : s);
  return {
    name: "openrouter",
    async chat(req) {
      const body = {
        model: req.model,
        messages: req.messages,
        response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
        max_tokens: req.maxTokens,
        temperature: 0,
        provider: { require_parameters: true, data_collection: "deny" },
      };
      let res: Response;
      try {
        res = await doFetch(OPENROUTER_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json", "X-Title": o.title ?? "Hub" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(req.timeoutMs),
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new LlmError(timedOut ? "timeout" : "network", timedOut ? `${req.model}: no answer in ${req.timeoutMs} ms` : `${req.model}: ${scrub(e instanceof Error ? e.message : "network error")}`);
      }
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok) {
        const kind = kindOfStatus(res.status);
        throw new LlmError(kind, scrub(`${req.model}: HTTP ${res.status}${errorText(json) ? `: ${errorText(json)}` : ""}`), { status: res.status, retryAfterMs: retryAfterMs(res.headers.get("retry-after")) });
      }
      // OpenRouter can answer 200 with an `error` object when the upstream failed mid-way.
      if (isRecord(json) && isRecord(json.error)) {
        const code = typeof json.error.code === "number" ? json.error.code : 502;
        throw new LlmError(kindOfStatus(code), scrub(`${req.model}: ${errorText(json) || "upstream error"}`), { status: code, usage: usageOf(json) });
      }
      const choice = isRecord(json) && Array.isArray(json.choices) && isRecord(json.choices[0]) ? json.choices[0] : null;
      if (!choice) throw new LlmError("upstream", `${req.model}: the answer has no choice`, { usage: usageOf(json) });
      const message = isRecord(choice.message) ? choice.message : {};
      return {
        content: typeof message.content === "string" ? message.content : null,
        finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
        usage: usageOf(json),
        generationId: isRecord(json) && typeof json.id === "string" ? json.id : null,
      };
    },
  };
}

export interface RetryPolicy {
  /** Retries after the first try, on a retryable error, same model. */
  retries: number;
  baseMs: number;
  capMs: number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const DEFAULT_RETRY: RetryPolicy = { retries: 2, baseMs: 1000, capMs: 20_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: Math.random };

/** Full-jitter backoff (a random wait up to base·2^n, capped), or `Retry-After` when the provider named one (capped too). */
export const backoffMs = (attempt: number, err: LlmError, p: RetryPolicy): number =>
  err.retryAfterMs !== null ? Math.min(err.retryAfterMs, p.capMs) : Math.floor(p.random() * Math.min(p.capMs, p.baseMs * 2 ** attempt));
