import { fakeMode } from "@hub/config/modes";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { instanceLlm, type InstanceLlm } from "@hub/config/llm";
import { hubPaths, machineDir } from "@hub/config/paths";

/**
 * The presets, the key and the instance's settings (decision 0039 points 2 and 6). A caller names a preset, never a model; a
 * preset is a list tried in order (the next vendor is the fallback). `config.json` → `llm.presets.<name>` may replace a list.
 */
export const PRESETS = {
  /** Plain extraction and labels: django-cfg's extraction primary (fast, 5/5 on its hardest nullable shape), then another vendor. */
  cheap: ["google/gemini-2.5-flash-lite", "openai/gpt-4o-mini"],
  /** Hard judgement and prose: a thinking model first, then a non-thinking one that does not truncate. */
  smart: ["google/gemini-3.1-flash-lite", "openai/gpt-4.1-mini"],
  /**
   * One object about a stretch of messages (the `window` shape, decision 0051): gpt-4o-mini first, because the watcher's
   * precision (16 of 20) and cost ($0.016 per 1 000 messages) were measured on it; Gemini leads only once it measures as precise
   * for no more cost (P144 W5).
   */
  window: ["openai/gpt-4o-mini", "google/gemini-2.5-flash-lite"],
} as const satisfies Record<string, readonly string[]>;
export type Preset = keyof typeof PRESETS;

/** Per attempt. A thinking model needs longer and a `max_tokens` floor: its reasoning eats the budget. */
export const PRESET_LIMITS: Record<Preset, { timeoutMs: number; minTokens: number }> = {
  cheap: { timeoutMs: 30_000, minTokens: 256 },
  smart: { timeoutMs: 60_000, minTokens: 2048 },
  window: { timeoutMs: 90_000, minTokens: 2048 },
};

/** A truncated answer is retried once with twice the budget, never above this. */
export const MAX_TOKENS_CAP = 32_768;

export const chainOf = (preset: Preset, cfg: Pick<InstanceLlm, "presets">): readonly string[] => cfg.presets[preset] ?? PRESETS[preset];

/** `<secrets>/openrouter-key`: the instance's own key (`HUB_CONFIG_DIR` overrides the folder; the rule is `@hub/config/paths`). */
export const keyFile = (env: NodeJS.ProcessEnv = process.env): string => join(hubPaths({ env }).secrets, "openrouter-key");

/** `<machine>/openrouter-key` (`~/.config/reforms-hub/`): one key every instance on the Mac reads (owner 2026-11-25); null without a HOME. */
export const machineKeyFile = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const dir = machineDir(env);
  return dir ? join(dir, "openrouter-key") : null;
};

/** The one sentence a missing key is said with: the error, the Overview's fix line and the docs say the same. */
export const noKeySentence = (env: NodeJS.ProcessEnv = process.env): string => {
  const machine = machineKeyFile(env);
  return `No OpenRouter key: set OPENROUTER_API_KEY, or put the key alone in ${machine ? `${machine} (every instance on this machine) or ` : ""}${keyFile(env)} (this instance), chmod 600.`;
};

/** The fix of a reached cap, said by the error and the Overview. */
export const capSentence = "Raise llm.monthly_cap_usd in config/config.json, or wait for the next month (UTC).";

/** Where the key in use comes from, first found wins: the variable, the machine's file, the instance's file. Never the value. */
export const KEY_SOURCES = ["env", "machine", "instance"] as const;
export type KeySource = (typeof KEY_SOURCES)[number];

/** A key file's value, or null when it is missing, empty or readable by others (refused, as `@hub/connections` refuses an unsafe token file). */
const fileKey = (file: string | null): string | null => {
  if (!file) return null;
  try {
    if ((statSync(file).mode & 0o077) !== 0) return null;
    const v = readFileSync(file, "utf8").trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
};

/** The key and its source, or null. Read on every call, so a key stored while the server runs is used at once. */
function findKey(env: NodeJS.ProcessEnv): { key: string; source: KeySource } | null {
  const fromEnv = env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const machine = fileKey(machineKeyFile(env));
  if (machine) return { key: machine, source: "machine" };
  const own = fileKey(keyFile(env));
  return own ? { key: own, source: "instance" } : null;
}

/** The key, or null. The value is never logged and never leaves this package except in the SDK's Authorization header. */
export const readKey = (env: NodeJS.ProcessEnv = process.env): string | null => findKey(env)?.key ?? null;

/** Which source holds the key in use, for the Settings note; null when none does. */
export const keySource = (env: NodeJS.ProcessEnv = process.env): KeySource | null => findKey(env)?.source ?? null;

/** Whether a key is there, for the Overview: the value is read and dropped here. */
export const hasKey = (env: NodeJS.ProcessEnv = process.env): boolean => readKey(env) !== null;

/** The instance's `llm` block (cap, preset overrides), read on every call like the key. */
export const readSettings = (env: NodeJS.ProcessEnv = process.env): InstanceLlm => instanceLlm(hubPaths({ env }));

/** `HUB_LLM=fake`: the fake transport answers, no key is needed and nothing leaves the process. Read by `@hub/config/modes`'s rule: any other value throws. */
export const llmFake = (env: NodeJS.ProcessEnv = process.env): boolean => fakeMode(env, "llm") === "fake";
