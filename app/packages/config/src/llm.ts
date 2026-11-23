import { readInstanceConfig } from "./instance";
import type { HubPaths } from "./paths";

/**
 * P78 (decision 0039): what `@hub/llm` and the `llm_calls` table share. The outcome of one attempt is a closed vocabulary, so the
 * table's column, the package's error kinds and the Overview part read one list. `ok` is the only outcome that answered.
 */
export const LLM_OUTCOMES = [
  "ok",
  // The answer came back but is unusable: wrong shape (re-asked once) or cut at max_tokens (retried once with twice the budget).
  "invalid",
  "truncated",
  // Retryable: the same model is tried again with jittered backoff (Retry-After honoured on 429).
  "timeout",
  "network",
  "rate_limit",
  "upstream",
  // Fatal for the model: the next model of the preset is tried.
  "bad_request",
  "no_endpoint",
  "content_filter",
  // Fatal for the key: nothing else is tried.
  "auth",
  "credits",
  // Refused by the Hub before any fetch (no row costs money).
  "budget",
  "no_key",
] as const;
export type LlmOutcome = (typeof LLM_OUTCOMES)[number];

/** The two outcomes the Hub decides without a request; they are what the Overview's LLM part reports. */
export const LLM_REFUSALS = ["budget", "no_key"] as const satisfies readonly LlmOutcome[];

/** Monthly spend cap when `config.json` names none: a paid key is never unlimited by omission. */
export const DEFAULT_LLM_CAP_USD = 5;

export interface InstanceLlm {
  /** `llm.monthly_cap_usd` as whole micro-dollars: the instance's total for the calendar month (UTC), over every project. 0 refuses every call. */
  capMicroUsd: number;
  /** `llm.presets.<name>`: a model list that replaces the core's chain for that preset (unknown names are ignored by the package). */
  presets: Record<string, string[]>;
}

/**
 * The `llm` block of `config/config.json` (tracked, no secrets): `{ "llm": { "monthly_cap_usd": 5, "presets": { "cheap": ["…"] } } }`.
 * A missing or unreadable file, or a cap that is not a number from 0 to 10 000, gives the default cap.
 */
export function instanceLlm(paths: Pick<HubPaths, "configFile">): InstanceLlm {
  const llm = readInstanceConfig(paths).config.llm;
  return { capMicroUsd: Math.round((llm?.monthly_cap_usd ?? DEFAULT_LLM_CAP_USD) * 1e6), presets: llm?.presets ?? {} };
}

/** `2026-11-01T00:00:00.000Z`: the first instant of `now`'s calendar month in UTC, the cap's window. */
export const monthStartUtc = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
