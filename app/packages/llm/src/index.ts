import type { z } from "zod";
import type { Ledger } from "./budget/ledger";
import type { CallDeps, RunResult } from "./retry/ladder";
import { DEFAULT_RETRY, type RetryPolicy } from "./retry/backoff";
import { llmFake, readKey, readSettings } from "./settings";
import { runBatchTask, type BatchInput, type BatchItem } from "./shapes/batch";
import { runObject, type ObjectInput } from "./shapes/object";
import { runWindowTask, type WindowInput, type WindowItem, type WindowResult } from "./shapes/window";
import type { BatchShape, ObjectShape, Shape, Task, WindowShape } from "./task";
import type { CostFilter } from "./budget/ledger";
import { fakeTransport } from "./transport/fake";
import { openRouterTransport } from "./transport/openrouter";
import type { Transport } from "./transport/types";

/**
 * `@hub/llm` (P78, decisions 0039 and 0051): the only code in the Hub that calls a model API. A caller declares a task
 * (`defineTask`: name, version, preset, schema, system text, shape, budget) and runs it with `llm.run(task, …)`; the shape
 * (`object`, `batch`, `window`) decides what the call takes and returns. Under it: OpenRouter through the official `openai` SDK
 * (`maxRetries: 0`), our ladder, a ledger row per attempt, the instance cap and the task budget before every attempt, and the
 * fake (`HUB_LLM=fake`). It imports `@hub/config`, zod and `openai` only: the caller hands it the ledger (`llm_calls` of `@hub/db`).
 */

export { memoryLedger, type CostFilter, type Ledger, type LlmCallRecord } from "./budget/ledger";
export type { RunResult } from "./retry/ladder";
export { capSentence, hasKey, KEY_SOURCES, keyFile, keySource, llmFake, machineKeyFile, noKeySentence, PRESETS, readKey, type KeySource, type Preset } from "./settings";
export { BATCH_RULE, type BatchInput, type BatchItem } from "./shapes/batch";
export type { ObjectInput } from "./shapes/object";
export { cutWindows, dedupeItems, mapEntries, renderLine, WINDOW_RULE, type WindowEntry, type WindowInput, type WindowItem, type WindowResult } from "./shapes/window";
export { readAnswer } from "./structured/answer";
export { plainJsonSchema, SchemaError, strictJsonSchema, stripOptionalNulls } from "./structured/schema";
export { defineTask, type BatchShape, type ObjectShape, type Shape, type Task, type TaskSpec, type WindowShape } from "./task";
export { FAKE_COST_USD, fakeTransport, sampleOf, type FakeReply, type FakeScript } from "./transport/fake";
export { OPENROUTER_BASE_URL, openRouterTransport } from "./transport/openrouter";
export { LlmError, type ChatRequest, type ChatResponse, type LlmErrorKind, type Message, type Transport } from "./transport/types";

export interface LlmDeps {
  ledger: Ledger;
  /** Tests: a transport of their own. Otherwise `HUB_LLM=fake` gives the fake, else OpenRouter with the key (none: `no_key`). */
  transport?: Transport;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  retry?: Partial<RetryPolicy>;
  /** Passed to the OpenRouter transport (tests); the global `fetch` otherwise. */
  fetch?: typeof fetch;
}

export type ObjectCall = Omit<ObjectInput, "maxTokens">;
export type BatchCall<I> = BatchInput<I>;
export type WindowCall = WindowInput;

export interface Llm {
  readonly transport: "openrouter" | "fake" | "none";
  run<S extends z.ZodType>(task: Task<S, ObjectShape>, call: ObjectCall): Promise<RunResult<z.output<S>>>;
  run<S extends z.ZodType, I>(task: Task<S, BatchShape>, call: BatchCall<I>): Promise<Array<BatchItem<z.output<S>>>>;
  run<S extends z.ZodType>(task: Task<S, WindowShape>, call: WindowCall): Promise<Array<WindowResult<z.output<S>>>>;
  /** Micro-dollars this month (UTC): the instance's, or one project's or task's. */
  monthCost(filter?: CostFilter): Promise<number>;
}

const isTask = <S extends z.ZodType, K extends Shape["kind"]>(t: Task<S, Shape>, kind: K): t is Task<S, Extract<Shape, { kind: K }>> => t.shape.kind === kind;

const isWindowItem = (v: unknown): v is WindowItem =>
  typeof v === "object" && v !== null && "id" in v && typeof v.id === "string" && "text" in v && typeof v.text === "string" && "author" in v && (v.author === null || typeof v.author === "string");

export function createLlm(deps: LlmDeps): Llm {
  const env = deps.env ?? process.env;
  // A bad HUB_LLM throws here, at start (the rule of `@hub/config/modes`).
  const fake = deps.transport ?? (llmFake(env) ? fakeTransport() : null);
  const transport = (): Transport | null => {
    if (fake) return fake;
    const key = readKey(env);
    return key ? openRouterTransport({ key, ...(deps.fetch ? { fetch: deps.fetch } : {}) }) : null;
  };
  const now = deps.now ?? (() => new Date());
  const callDeps: CallDeps = { transport, ledger: deps.ledger, settings: () => readSettings(env), retry: { ...DEFAULT_RETRY, ...deps.retry }, now, env };

  function run<S extends z.ZodType>(task: Task<S, ObjectShape>, call: ObjectCall): Promise<RunResult<z.output<S>>>;
  function run<S extends z.ZodType, I>(task: Task<S, BatchShape>, call: BatchCall<I>): Promise<Array<BatchItem<z.output<S>>>>;
  function run<S extends z.ZodType>(task: Task<S, WindowShape>, call: WindowCall): Promise<Array<WindowResult<z.output<S>>>>;
  function run<S extends z.ZodType, I>(task: Task<S, Shape>, call: ObjectCall | BatchCall<I> | WindowCall): Promise<unknown> {
    if (isTask(task, "object") && "input" in call) return runObject(task, call, callDeps, task.shape.maxTokens ?? 1024);
    if (isTask(task, "batch") && "items" in call) return runBatchTask(task, call, callDeps);
    if (isTask(task, "window") && "items" in call) return runWindowTask(task, { ...call, items: call.items.filter(isWindowItem) }, callDeps);
    return Promise.reject(new Error(`task ${task.name}: the call does not match its ${task.shape.kind} shape`));
  }

  return {
    get transport() {
      const t = transport();
      return t ? t.name : "none";
    },
    run,
    monthCost: (filter) => deps.ledger.monthCost(filter ?? {}, now()),
  };
}
