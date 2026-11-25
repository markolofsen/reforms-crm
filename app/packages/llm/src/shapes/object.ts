import type { z } from "zod";
import { ladder, type CallDeps, type RunResult, type RunSpec } from "../retry/ladder";
import { schemaName, validatorOf, type Validated } from "../structured/answer";
import type { Preset } from "../settings";
import type { Shape, Task } from "../task";
import type { Message } from "../transport/types";

/** The part of a task the ladder needs, whatever its schema and shape. */
export interface TaskMeta {
  readonly name: string;
  readonly preset: Preset;
  readonly source?: { kind: string } | undefined;
  readonly budget?: { monthlyUsd: number } | undefined;
}

/** What every shape hands the ladder from its task: the ledger's name and source, the preset, the budget. */
export const specOf = <T>(task: TaskMeta, o: { project: string; system: string; input: Message[]; schema: Record<string, unknown>; maxTokens: number; validate: (json: unknown) => Validated<T> }): RunSpec<T> => ({
  task: task.name,
  project: o.project,
  preset: task.preset,
  sourceKind: task.source?.kind ?? null,
  messages: [{ role: "system", content: o.system }, ...o.input],
  schemaName: schemaName(task.name),
  schema: o.schema,
  maxTokens: o.maxTokens,
  budgetMicroUsd: task.budget ? Math.round(task.budget.monthlyUsd * 1e6) : null,
  validate: o.validate,
});

/** The task's fixed system text, then the call's own lines, then a shape's rule. */
export const systemOf = (fixed: string, instructions: string | undefined, rule?: string): string => [fixed, instructions?.trim() || null, rule ?? null].filter((x): x is string => x !== null).join("\n\n");

export interface ObjectInput {
  project: string;
  /** The user turn: client text is data here, never in the system text. */
  input: string | Message[];
  /** Lines added after the task's system text for this call only (a chat's language and the owner's instruction). */
  instructions?: string;
  /** A tighter answer budget than the task's (an item asked again alone). */
  maxTokens?: number;
}

/** `object`: one request, one validated answer, through the ladder. */
export function runObject<S extends z.ZodType>(task: Task<S, Shape>, call: ObjectInput, deps: CallDeps, defaultTokens: number, rule?: string): Promise<RunResult<z.output<S>>> {
  const input: Message[] = typeof call.input === "string" ? [{ role: "user", content: call.input }] : call.input;
  return ladder(specOf(task, { project: call.project, system: systemOf(task.system, call.instructions, rule), input, schema: task.wire, maxTokens: call.maxTokens ?? defaultTokens, validate: validatorOf(task.schema) }), deps);
}
