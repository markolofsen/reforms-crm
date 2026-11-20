import { z } from "zod";

/**
 * zod 4 → the strict JSON Schema an OpenRouter `json_schema` request carries (the port of django-cfg's `_strictify`,
 * `structured/response_format.py:36-118`), and the parse of the answer back. P78 L0 (offline) settled the walk against
 * Gemini's documented subset and OpenAI's strict mode, so one schema serves both legs of a preset:
 *
 * - every object is closed (`additionalProperties: false`) and lists every key in `required`;
 * - an optional key becomes `anyOf [T, null]` and required; `stripOptionalNulls` turns that null back into a missing key
 *   before zod sees it, so `.optional()` keeps its meaning;
 * - `oneOf` (zod's discriminated union) becomes `anyOf` (OpenAI strict rejects `oneOf`, Gemini does not list it);
 * - `const` (zod's literal) becomes a one-value `enum` (Gemini does not list `const`);
 * - bounds and decoration are dropped: `default`, `$schema`, `title`, `pattern`, `format`, `minimum` and the like, lengths,
 *   item counts. zod enforces them locally after the parse, as django-cfg does. `description` is KEPT: it is what the model
 *   reads as the instruction for a field (django-cfg drops it; nothing in either subset rejects it).
 * - a recursive schema (`$ref`) is refused here, before any request: neither leg needs one yet.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Node = Record<string, unknown>;

const DROP = new Set([
  "$schema", "$id", "title", "default", "examples", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "contentEncoding", "contentMediaType",
]);

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

/** The plain zod 4 JSON Schema, input side (a field with a default is optional to the model, and zod fills it in). */
export function plainJsonSchema(schema: z.ZodType): Node {
  const out: unknown = z.toJSONSchema(schema, { io: "input", unrepresentable: "throw" });
  if (!isNode(out)) throw new SchemaError("zod gave no JSON Schema object");
  return out;
}

const nullable = (n: Node): Node => {
  const branches = Array.isArray(n.anyOf) ? n.anyOf : null;
  if (branches?.some((b) => isNode(b) && b.type === "null")) return n;
  if (n.type === "null") return n;
  return { anyOf: [n, { type: "null" }] };
};

function strictNode(n: unknown, path: string): Node {
  if (!isNode(n)) throw new SchemaError(`${path}: not a schema`);
  if ("$ref" in n || "$defs" in n || "definitions" in n) throw new SchemaError(`${path}: recursive or shared schemas ($ref) are not supported`);
  const out: Node = {};
  for (const [k, v] of Object.entries(n)) {
    if (DROP.has(k)) continue;
    if (k === "const") out.enum = [v];
    else if (k === "oneOf" || k === "anyOf") {
      if (!Array.isArray(v)) throw new SchemaError(`${path}.${k}: not a list`);
      out.anyOf = v.map((b, i) => strictNode(b, `${path}.${k}[${i}]`));
    } else if (k === "allOf") throw new SchemaError(`${path}: allOf (an intersection) is not supported`);
    else if (k === "items") out.items = strictNode(v, `${path}[]`);
    else if (k === "prefixItems") throw new SchemaError(`${path}: tuples are not supported`);
    else if (k === "properties" || k === "required" || k === "additionalProperties") continue;
    else out[k] = v;
  }
  if (Array.isArray(n.type) && !("enum" in n)) {
    delete out.type;
    out.anyOf = n.type.map((t) => ({ type: t }));
  }
  if (isNode(n.properties)) {
    const required = new Set(Array.isArray(n.required) ? n.required.filter((r): r is string => typeof r === "string") : []);
    const props: Node = {};
    for (const [key, sub] of Object.entries(n.properties)) {
      const s = strictNode(sub, `${path}.${key}`);
      props[key] = required.has(key) ? s : nullable(s);
    }
    out.properties = props;
    out.required = Object.keys(props);
    out.additionalProperties = false;
  } else if (n.type === "object") {
    if (isNode(n.additionalProperties) || n.additionalProperties === true) throw new SchemaError(`${path}: an open record has no strict form; name its keys`);
    out.properties = {};
    out.required = [];
    out.additionalProperties = false;
  }
  return out;
}

/** The strict wire schema. The root must be an object (both providers require it). */
export function strictJsonSchema(schema: z.ZodType): Node {
  const plain = plainJsonSchema(schema);
  if (plain.type !== "object") throw new SchemaError("the root of an LLM schema must be an object (z.object)");
  return strictNode(plain, "$");
}

/**
 * The answer's nulls for keys the plain schema left optional are removed, so zod sees a missing key, as the caller wrote it.
 * Walks objects, arrays and every `anyOf`/`oneOf` branch that is an object.
 */
export function stripOptionalNulls(value: unknown, plain: unknown): unknown {
  if (!isNode(plain)) return value;
  if (Array.isArray(value)) return isNode(plain.items) ? value.map((v) => stripOptionalNulls(v, plain.items)) : value;
  return isNode(value) ? stripObject(value, plain) : value;
}

/** A union branch applies when every literal (`const`) it names matches the value: the discriminator picks the branch. */
const branchFits = (obj: Node, b: Node): boolean =>
  isNode(b.properties) && Object.entries(b.properties).every(([k, s]) => !isNode(s) || !("const" in s) || obj[k] === s.const);

function stripObject(obj: Node, plain: Node): Node {
  let out: Node = { ...obj };
  const branches = [...(Array.isArray(plain.anyOf) ? plain.anyOf : []), ...(Array.isArray(plain.oneOf) ? plain.oneOf : [])];
  for (const b of branches) if (isNode(b) && branchFits(out, b)) out = stripObject(out, b);
  if (isNode(plain.properties)) {
    const required = new Set(Array.isArray(plain.required) ? plain.required : []);
    for (const [key, sub] of Object.entries(plain.properties)) {
      if (!(key in out)) continue;
      if (out[key] === null && !required.has(key)) delete out[key];
      else out[key] = stripOptionalNulls(out[key], sub);
    }
  }
  return out;
}

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
