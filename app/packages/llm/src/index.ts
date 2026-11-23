import type { z } from "zod";
import { BATCH_RULE, envelopeOf, runBatch, type BatchItem } from "./batch";
import { run, type CallDeps, type RunResult, type Validated } from "./call";
import { fakeTransport } from "./fake";
import type { Ledger } from "./ledger";
import { issuesText, plainJsonSchema, schemaName, strictJsonSchema, stripOptionalNulls } from "./schema";
import { llmFake, readKey, readSettings, type Preset } from "./settings";
import { DEFAULT_RETRY, openRouterTransport, type Message, type RetryPolicy, type Transport } from "./transport";

/**
 * `@hub/llm` (P78, decision 0039): the only code in the Hub that calls a model API. Two calls, `object` and `batch`, typed by a zod
 * 4 schema; OpenRouter over plain `fetch`; presets, never model names; a ledger row per attempt; the monthly cap checked before
 * every request. It imports `@hub/config` and zod only: the caller hands it the ledger (the `llm_calls` repository of `@hub/db`).
 */

export { BATCH_RULE, type BatchItem } from "./batch";
export type { RunResult } from "./call";
export { FAKE_COST_USD, fakeTransport, sampleOf, type FakeReply, type FakeScript } from "./fake";
export { memoryLedger, type Ledger, type LlmCallRecord } from "./ledger";
export { plainJsonSchema, readAnswer, SchemaError, strictJsonSchema, stripOptionalNulls } from "./schema";
export { capSentence, llmFake, hasKey, keyFile, noKeySentence, PRESETS, readKey, type Preset } from "./settings";
export { LlmError, OPENROUTER_URL, openRouterTransport, type ChatRequest, type ChatResponse, type LlmErrorKind, type Message, type Transport } from "./transport";

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

interface Common {
  /** The job's name, for the ledger (`messages.preanalysis`): never a model, never client text. */
  task: string;
  /** Stable text first: it is the prefix a provider's prompt cache can reuse. */
  system: string;
  project: string;
  source?: { kind: string };
  preset?: Preset;
}

export interface ObjectCall<S extends z.ZodType> extends Common {
  schema: S;
  input: string | Message[];
  maxTokens?: number;
}

export interface BatchCall<S extends z.ZodType, I> extends Common {
  /** The schema of ONE item's answer. */
  schema: S;
  items: readonly I[];
  /** What the model sees of one item (JSON); the item itself by default. */
  render?: (item: I) => unknown;
  /** Items per request (default 20, at most 50). */
  perCall?: number;
  /** Requests at once (default 3). */
  concurrency?: number;
  /** Answer budget per item (default 200 tokens). */
  maxTokensPerItem?: number;
}

export interface Llm {
  readonly transport: "openrouter" | "fake" | "none";
  object<S extends z.ZodType>(call: ObjectCall<S>): Promise<RunResult<z.output<S>>>;
  batch<S extends z.ZodType, I>(call: BatchCall<S, I>): Promise<Array<BatchItem<z.output<S>>>>;
  /** Micro-dollars this month (UTC): one project's, or the instance's without one. */
  monthCost(project?: string): Promise<number>;
}

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

  const object = <S extends z.ZodType>(c: ObjectCall<S>): Promise<RunResult<z.output<S>>> => {
    const plain = plainJsonSchema(c.schema);
    const validate = (json: unknown): Validated<z.output<S>> => {
      const r = c.schema.safeParse(stripOptionalNulls(json, plain));
      return r.success ? { ok: true, value: r.data } : { ok: false, issues: issuesText(r.error) };
    };
    const input: Message[] = typeof c.input === "string" ? [{ role: "user", content: c.input }] : c.input;
    return run(
      { task: c.task, project: c.project, preset: c.preset ?? "cheap", sourceKind: c.source?.kind ?? null, messages: [{ role: "system", content: c.system }, ...input], schemaName: schemaName(c.task), schema: strictJsonSchema(c.schema), maxTokens: c.maxTokens ?? 1024, validate },
      callDeps,
    );
  };

  return {
    get transport() {
      const t = transport();
      return t ? t.name : "none";
    },
    object,
    async batch<S extends z.ZodType, I>(c: BatchCall<S, I>) {
      const render = c.render ?? ((item: I): unknown => item);
      // An item is asked again alone through `object`, whose root must be an object: refuse another shape before any request.
      strictJsonSchema(c.schema);
      const wire = strictJsonSchema(envelopeOf(c.schema));
      const perItem = c.maxTokensPerItem ?? 200;
      return runBatch({
        schema: c.schema,
        items: c.items,
        perCall: c.perCall ?? 20,
        concurrency: c.concurrency ?? 3,
        runner: {
          chunk: (entries, validate) =>
            run(
              {
                task: c.task,
                project: c.project,
                preset: c.preset ?? "cheap",
                sourceKind: c.source?.kind ?? null,
                messages: [{ role: "system", content: `${c.system}\n\n${BATCH_RULE}` }, { role: "user", content: JSON.stringify({ items: entries.map((e) => ({ i: e.i, input: render(e.item) })) }) }],
                schemaName: schemaName(c.task),
                schema: wire,
                maxTokens: 200 + perItem * entries.length,
                validate,
              },
              callDeps,
            ),
          alone: (item) => object({ task: c.task, system: c.system, project: c.project, input: JSON.stringify(render(item)), schema: c.schema, maxTokens: 200 + perItem, ...(c.source ? { source: c.source } : {}), ...(c.preset ? { preset: c.preset } : {}) }),
        },
      });
    },
    monthCost: (project) => deps.ledger.monthCost(project, now()),
  };
}
