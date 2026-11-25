import type { z } from "zod";
import type { Preset } from "./settings";
import { strictJsonSchema } from "./structured/schema";

/**
 * A declared task (decision 0051): what a caller wants from a model, stated once at module level and run with `llm.run(task, …)`.
 * The declaration carries everything that does not change per call: the name the ledger keeps, a version the caller stores beside
 * its results, the preset (the named model chain, overridable in `config.json`), the answer's schema, the stable system text, the
 * shape and an optional monthly budget. The schema is walked to its strict form at definition, so a schema neither vendor accepts
 * fails at import, before any request.
 */

/** One answer for one input. */
export interface ObjectShape {
  kind: "object";
  /** The answer's token budget (default 1024). */
  maxTokens?: number;
}

/** One answer per item, many items per request (at most 50); a failed item is asked again alone. */
export interface BatchShape {
  kind: "batch";
  /** Items per request (default 20, at most 50). */
  perCall?: number;
  /** Answer budget per item (default 200 tokens). */
  maxTokensPerItem?: number;
  /** Requests at once (default 3). */
  concurrency?: number;
}

/**
 * One answer about a stretch of ordered messages (P144): the items are cut into windows of `size` with `overlap` items shared by
 * neighbours, shown as `[n] author: text`. The answer's `list` field holds entries that point at messages by index: `index` names
 * the entry's own message (the speaker) and `refs` names fields that hold lists of indexes (the reactors). The shape maps those
 * indexes back to item ids and drops an entry repeated in two windows' overlap (same speaker item and same `key` field value).
 * The schema's field order is the author's job: fields the model should think through first (threads, topics, mood) come before
 * the list, or the list comes back empty.
 */
export interface WindowShape {
  kind: "window";
  size: number;
  overlap: number;
  list: string;
  index: string;
  refs?: readonly string[];
  /** A field of the entry that, with the speaker's item id, identifies a repeat (the trigger). */
  key?: string;
  /** The answer's token budget per window (default 4096). */
  maxTokens?: number;
  /** Windows at once (default 2). */
  concurrency?: number;
}

export type Shape = ObjectShape | BatchShape | WindowShape;

export interface TaskSpec<S extends z.ZodType, Sh extends Shape> {
  /** The ledger's name of the job (`messages.preanalysis`): never a model, never client text. */
  name: string;
  /** The prompt's version, a whole number from 1: bump it when the prompt or schema changes meaning; callers store it beside a result. */
  version: number;
  preset: Preset;
  /** For `batch`, the schema of ONE item's answer; otherwise the whole answer. The root is an object. */
  schema: S;
  /**
   * The fixed system text. A call may add its own lines after it (`instructions`: a chat's rules); the fixed text comes first
   * so a provider's prompt cache can reuse the prefix. Client text is never here: it is the user turn.
   */
  system: string;
  shape: Sh;
  /** The task's own monthly budget inside the instance cap. */
  budget?: { monthlyUsd: number };
  /** The ledger's `source_kind` (what the input was), never its content. */
  source?: { kind: string };
}

export interface Task<S extends z.ZodType, Sh extends Shape> extends Readonly<TaskSpec<S, Sh>> {
  /** The strict wire schema, computed once. */
  readonly wire: Record<string, unknown>;
}

const POSITIVE = (n: number | undefined, what: string): void => {
  if (n !== undefined && !(Number.isFinite(n) && n > 0)) throw new Error(`${what} must be a positive number`);
};

/** Checks and freezes a declaration. Throws at import on a schema with no strict form or a shape that cannot work. */
export function defineTask<S extends z.ZodType, const Sh extends Shape>(spec: TaskSpec<S, Sh>): Task<S, Sh> {
  if (!/^[a-z][a-z0-9_.-]*$/.test(spec.name)) throw new Error(`task name "${spec.name}": lower case, digits, ".", "_" and "-" only`);
  if (!(Number.isInteger(spec.version) && spec.version >= 1)) throw new Error(`task ${spec.name}: the version must be a whole number from 1`);
  POSITIVE(spec.budget?.monthlyUsd, `task ${spec.name}: budget.monthlyUsd`);
  if (spec.shape.kind === "window") {
    const { size, overlap } = spec.shape;
    if (!(Number.isInteger(size) && size >= 2)) throw new Error(`task ${spec.name}: window size must be a whole number of at least 2`);
    if (!(Number.isInteger(overlap) && overlap >= 0 && overlap < size)) throw new Error(`task ${spec.name}: window overlap must be a whole number below the size`);
  }
  const wire = strictJsonSchema(spec.schema);
  if (spec.shape.kind === "window") windowFields(spec.name, wire, spec.shape);
  return Object.freeze({ ...spec, wire });
}

const isNode = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The window's `list`, `index`, `refs` and `key` must be real fields of the answer: checked on the strict schema at definition. */
function windowFields(name: string, wire: Record<string, unknown>, shape: WindowShape): void {
  const props = isNode(wire.properties) ? wire.properties : {};
  const list = props[shape.list];
  const entry = isNode(list) && isNode(list.items) ? list.items : null;
  const fields = entry && isNode(entry.properties) ? entry.properties : null;
  if (!fields) throw new Error(`task ${name}: window list "${shape.list}" is not a list of objects in the schema`);
  for (const f of [shape.index, ...(shape.refs ?? []), ...(shape.key ? [shape.key] : [])]) {
    if (!(f in fields)) throw new Error(`task ${name}: window field "${f}" is not a field of "${shape.list}" entries`);
  }
}
