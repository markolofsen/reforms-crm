import { z } from "zod";
import { ladder, type CallDeps, type RunResult } from "../retry/ladder";
import { issuesText, validatorOf, type Validated } from "../structured/answer";
import { strictJsonSchema } from "../structured/schema";
import type { BatchShape, Task } from "../task";
import { LlmError } from "../transport/types";
import { runObject, specOf, systemOf } from "./object";

/**
 * The `batch` shape (decision 0039 point 1, a declared task since 0051): many items in one request (OpenRouter has no batch endpoint), a result per item, in input
 * order. The model answers `{ items: [{ i, value }] }`. Only the envelope is checked by the ladder (a list of objects with an
 * integer `i`); each `value` is then checked against the item schema alone, so one bad item never fails the other nineteen. An
 * item whose answer is missing, duplicated or invalid is asked again ONCE, alone, as an `object` call of the same task; if that fails too, only
 * that item fails. A whole chunk that fails (the cap, the key, every model down) fails its items with that error, not re-asked.
 */

export type BatchItem<T> = { i: number; ok: true; value: T; model: string } | { i: number; ok: false; error: LlmError };

export interface ChunkRunner<I> {
  /** One request for a chunk: the envelope validated, each value still unchecked. */
  chunk(entries: Array<{ i: number; item: I }>, validate: (json: unknown) => Validated<Array<{ i: number; value: unknown }>>): Promise<RunResult<Array<{ i: number; value: unknown }>>>;
  /** The second chance of one item, alone. */
  alone(item: I): Promise<RunResult<unknown>>;
}

const Envelope = z.object({ items: z.array(z.looseObject({ i: z.number().int(), value: z.unknown() })) });

const validateEnvelope = (json: unknown): Validated<Array<{ i: number; value: unknown }>> => {
  const r = Envelope.safeParse(json);
  return r.success ? { ok: true, value: r.data.items.map((x) => ({ i: x.i, value: x.value })) } : { ok: false, issues: issuesText(r.error) };
};

/** The wire envelope for the item schema: what the strict walk turns into the request's `json_schema`. */
export const envelopeOf = (item: z.ZodType) => z.object({ items: z.array(z.object({ i: z.number().int(), value: item })) });

/** The instruction appended to the caller's system text: stable, so a provider's prompt cache can reuse the prefix. */
export const BATCH_RULE =
  'You get a JSON object {"items":[{"i":<number>,"input":<the input>}]}. Answer {"items":[{"i":<the same number>,"value":<your answer for that input>}]} with exactly one entry per input, every i once.';

/** At most `limit` of `jobs` at once, results in order. */
export async function pool<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const k = next++;
      const job = jobs[k];
      if (job) out[k] = await job();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, worker));
  return out;
}

const asLlmError = (e: unknown): LlmError => (e instanceof LlmError ? e : new LlmError("upstream", e instanceof Error ? e.message.slice(0, 300) : "the call failed"));

export async function runBatch<S extends z.ZodType, I>(o: { schema: S; items: readonly I[]; perCall: number; concurrency: number; runner: ChunkRunner<I> }): Promise<Array<BatchItem<z.output<S>>>> {
  const check = validatorOf(o.schema);
  const perCall = Math.max(1, Math.min(50, Math.round(o.perCall)));
  const entries = o.items.map((item, i) => ({ i, item }));
  const chunks: Array<typeof entries> = [];
  for (let k = 0; k < entries.length; k += perCall) chunks.push(entries.slice(k, k + perCall));
  const results: Array<BatchItem<z.output<S>> | undefined> = new Array(entries.length);
  const again: Array<{ i: number; item: I }> = [];

  await pool(
    chunks.map((chunk) => async () => {
      let r: RunResult<Array<{ i: number; value: unknown }>>;
      try {
        r = await o.runner.chunk(chunk, validateEnvelope);
      } catch (e) {
        const error = asLlmError(e);
        for (const c of chunk) results[c.i] = { i: c.i, ok: false, error };
        return;
      }
      for (const c of chunk) {
        const answers = r.value.filter((a) => a.i === c.i);
        const v = answers.length === 1 && answers[0] ? check(answers[0].value) : null;
        if (v?.ok) results[c.i] = { i: c.i, ok: true, value: v.value, model: r.model };
        else again.push(c);
      }
    }),
    o.concurrency,
  );

  await pool(
    again.map((c) => async () => {
      try {
        const r = await o.runner.alone(c.item);
        const v = check(r.value);
        results[c.i] = v.ok ? { i: c.i, ok: true, value: v.value, model: r.model } : { i: c.i, ok: false, error: new LlmError("invalid", v.issues) };
      } catch (e) {
        results[c.i] = { i: c.i, ok: false, error: asLlmError(e) };
      }
    }),
    o.concurrency,
  );

  return results.map((r, i) => r ?? { i, ok: false, error: new LlmError("upstream", "no result") });
}

export interface BatchInput<I> {
  project: string;
  items: readonly I[];
  /** What the model sees of one item (JSON); the item itself by default. */
  render?: (item: I) => unknown;
  /** Lines added after the task's system text for this call only. */
  instructions?: string;
}

/** A `batch` task's run: chunks through the ladder, then each item that failed asked again alone. */
export function runBatchTask<S extends z.ZodType, I>(task: Task<S, BatchShape>, call: BatchInput<I>, deps: CallDeps): Promise<Array<BatchItem<z.output<S>>>> {
  const render = call.render ?? ((item: I): unknown => item);
  const wire = strictJsonSchema(envelopeOf(task.schema));
  const perItem = task.shape.maxTokensPerItem ?? 200;
  return runBatch({
    schema: task.schema,
    items: call.items,
    perCall: task.shape.perCall ?? 20,
    concurrency: task.shape.concurrency ?? 3,
    runner: {
      chunk: (entries, validate) =>
        ladder(specOf(task, { project: call.project, system: systemOf(task.system, call.instructions, BATCH_RULE), input: [{ role: "user", content: JSON.stringify({ items: entries.map((e) => ({ i: e.i, input: render(e.item) })) }) }], schema: wire, maxTokens: 200 + perItem * entries.length, validate }), deps),
      alone: (item) => runObject(task, { project: call.project, input: JSON.stringify(render(item)), ...(call.instructions ? { instructions: call.instructions } : {}), maxTokens: 200 + perItem }, deps, 200 + perItem),
    },
  });
}
