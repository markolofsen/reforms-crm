import type { InstanceLlm, LlmOutcome } from "@hub/config/llm";
import type { Ledger } from "../budget/ledger";
import { checkLimits } from "../budget/limits";
import { chainOf, MAX_TOKENS_CAP, noKeySentence, PRESET_LIMITS, type Preset } from "../settings";
import { readAnswer, reask, type Validated } from "../structured/answer";
import { LlmError, ZERO_USAGE, type ChatResponse, type Message, type Transport, type Usage } from "../transport/types";
import { backoffMs, type RetryPolicy } from "./backoff";

/**
 * The ladder of one structured call (django-cfg's `LLMRouter.parse`, `routing/llm_router.py:372-505`, made smaller). Per model of
 * the preset: retryable failures (timeout, network, 429, 5xx) are retried on the same model with jittered backoff; a cut answer
 * (`finish_reason: "length"`) is retried once with twice the `max_tokens`, never repaired; a wrong shape is re-asked once with
 * zod's issues; then the next model. The key's own failures (auth, credits) and the Hub's refusals (budget, no key) stop at once.
 * Before EVERY attempt the month's spend is checked against the instance cap and the task's own budget (`budget/limits.ts`), so
 * a refused call makes no request. Every attempt, the refused ones too, is one ledger row. The SDK under the transport retries
 * nothing (`maxRetries: 0`): this ladder is the only one.
 */

export interface CallDeps {
  /** The transport, or null when there is no key (`HUB_LLM=fake` never needs one). */
  transport: () => Transport | null;
  ledger: Ledger;
  settings: () => InstanceLlm;
  retry: RetryPolicy;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export interface RunSpec<T> {
  task: string;
  project: string;
  preset: Preset;
  sourceKind: string | null;
  messages: Message[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  /** The task's own monthly budget in micro-dollars, or null (the instance cap still applies). */
  budgetMicroUsd: number | null;
  validate: (json: unknown) => Validated<T>;
}

export interface RunResult<T> {
  value: T;
  /** The model that answered. */
  model: string;
  /** Attempts this call made (each one a ledger row). */
  attempts: number;
  /** What the whole call cost, failed attempts included. */
  costMicroUsd: number;
}

export async function ladder<T>(spec: RunSpec<T>, deps: CallDeps): Promise<RunResult<T>> {
  let attempts = 0;
  let spent = 0;
  const record = async (model: string | null, outcome: LlmOutcome, usage: Usage, latencyMs: number, generationId: string | null) => {
    spent += usage.costMicroUsd;
    await deps.ledger.record({ project: spec.project, task: spec.task, model, attempt: Math.max(1, attempts), outcome, ...usage, latencyMs, generationId, sourceKind: spec.sourceKind }, deps.now());
  };

  const transport = deps.transport();
  if (!transport) {
    await record(null, "no_key", ZERO_USAGE, 0, null);
    throw new LlmError("no_key", noKeySentence(deps.env));
  }
  const settings = deps.settings();
  const limits = PRESET_LIMITS[spec.preset];
  const taskLimit = spec.budgetMicroUsd === null ? null : { name: spec.task, budgetMicroUsd: spec.budgetMicroUsd };
  let last: LlmError | null = null;

  for (const model of chainOf(spec.preset, settings)) {
    let maxTokens = Math.min(MAX_TOKENS_CAP, Math.max(spec.maxTokens, limits.minTokens));
    let messages: Message[] = spec.messages;
    let bumped = false;
    let reasked = false;
    let retries = 0;
    for (;;) {
      try {
        await checkLimits(deps.ledger, { capMicroUsd: settings.capMicroUsd, task: taskLimit }, deps.now());
      } catch (e) {
        await record(model, "budget", ZERO_USAGE, 0, null);
        throw e;
      }
      attempts += 1;
      const t0 = deps.now().getTime();
      let reply: ChatResponse;
      try {
        reply = await transport.chat({ model, messages, schemaName: spec.schemaName, schema: spec.schema, maxTokens, timeoutMs: limits.timeoutMs });
      } catch (e) {
        const err = e instanceof LlmError ? e : new LlmError("network", `${model}: the transport failed`);
        await record(model, err.code, err.usage ?? ZERO_USAGE, deps.now().getTime() - t0, null);
        if (err.stopsChain) throw err;
        if (err.retryable && retries < deps.retry.retries) {
          await deps.retry.sleep(backoffMs(retries, err, deps.retry));
          retries += 1;
          continue;
        }
        last = err;
        break;
      }
      const latency = deps.now().getTime() - t0;
      const answer = readAnswer(reply.content, reply.finishReason);
      if (answer.kind === "truncated") {
        await record(model, "truncated", reply.usage, latency, reply.generationId);
        if (!bumped && maxTokens < MAX_TOKENS_CAP) {
          bumped = true;
          maxTokens = Math.min(MAX_TOKENS_CAP, maxTokens * 2);
          continue;
        }
        last = new LlmError("truncated", `${model}: the answer was cut at ${maxTokens} tokens`);
        break;
      }
      let issues: string;
      if (answer.kind === "json") {
        const v = spec.validate(answer.value);
        if (v.ok) {
          await record(model, "ok", reply.usage, latency, reply.generationId);
          return { value: v.value, model, attempts, costMicroUsd: spent };
        }
        issues = v.issues;
      } else {
        issues = answer.kind === "empty" ? "the answer was empty" : `the answer was not JSON (${answer.message})`;
      }
      await record(model, "invalid", reply.usage, latency, reply.generationId);
      if (!reasked) {
        reasked = true;
        messages = reask(spec.messages, reply.content, issues);
        continue;
      }
      last = new LlmError("invalid", `${model}: ${issues}`);
      break;
    }
  }
  throw last ?? new LlmError("upstream", "no model of the preset answered");
}
