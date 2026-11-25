import type { z } from "zod";
import type { Message } from "../transport/types";
import { plainJsonSchema, stripOptionalNulls } from "./schema";

/**
 * Reading an answer back (decision 0039 point 1): the text to JSON, the JSON to the caller's zod output, and the one-line issues
 * the re-ask carries. A cut answer is never repaired.
 */

export type Validated<T> = { ok: true; value: T } | { ok: false; issues: string };

/** What one answer's text is: JSON, a cut answer (never repaired), or text that is not JSON. */
export type Answer = { kind: "json"; value: unknown } | { kind: "truncated" } | { kind: "syntax"; message: string } | { kind: "empty" };

/** Strips a Markdown fence if a model added one, then `JSON.parse`. `finish_reason: "length"` is a cut answer whatever the text. */
export function readAnswer(content: string | null, finishReason: string | null): Answer {
  if (finishReason === "length") return { kind: "truncated" };
  const text = (content ?? "").trim();
  if (text === "") return { kind: "empty" };
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(text);
  try {
    return { kind: "json", value: JSON.parse(fenced?.[1] ?? text) };
  } catch (e) {
    return { kind: "syntax", message: e instanceof Error ? e.message.slice(0, 200) : "not JSON" };
  }
}

/** zod's issues in one short line for the re-ask: paths and messages, never the values. */
export const issuesText = (error: z.ZodError): string =>
  error.issues
    .slice(0, 8)
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ")
    .slice(0, 800);

/** A name OpenRouter accepts for `json_schema.name` (letters, digits, `_`, `-`; at most 64). */
export const schemaName = (task: string): string => task.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64) || "answer";

/** The check of one answer against `schema`: optional keys answered as null are dropped first, so `.optional()` keeps its meaning. */
export function validatorOf<S extends z.ZodType>(schema: S): (json: unknown) => Validated<z.output<S>> {
  const plain = plainJsonSchema(schema);
  return (json) => {
    const r = schema.safeParse(stripOptionalNulls(json, plain));
    return r.success ? { ok: true, value: r.data } : { ok: false, issues: issuesText(r.error) };
  };
}

/** The re-ask after a wrong shape: the model's own answer, then zod's issues (paths and messages, never values). */
export const reask = (base: Message[], content: string | null, issues: string): Message[] => [
  ...base,
  ...(content ? [{ role: "assistant" as const, content: content.slice(0, 8000) }] : []),
  { role: "user", content: `Your answer did not match the required JSON schema: ${issues}. Answer again with only the corrected JSON.` },
];
