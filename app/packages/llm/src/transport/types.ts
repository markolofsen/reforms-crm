import { HubError, type ErrorKind } from "@hub/config/errors";
import type { LlmOutcome } from "@hub/config/llm";

/**
 * What every transport shares (decision 0051): one request, one answer or one `LlmError`. The OpenRouter transport
 * (`openrouter.ts`, the `openai` SDK) and the fake (`fake.ts`) both speak it; the ladder (`retry/ladder.ts`) never sees which.
 */

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

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
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
