import type { LlmError } from "../transport/types";

/** How the ladder waits between retries of one model (decision 0039 point 1; the SDK's own retries are off, `maxRetries: 0`). */
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
