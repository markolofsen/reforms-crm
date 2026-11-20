import { describe, expect, it } from "vitest";
import { z } from "zod";
import { plainJsonSchema, readAnswer, SchemaError, strictJsonSchema, stripOptionalNulls } from "../src/schema";

// P78 L0 (offline half) and L1: the strict walk against Gemini's documented subset and OpenAI's strict mode.
const Shape = z.object({
  label: z.enum(["lead", "spam", "other"]).describe("what the message is"),
  note: z.string().optional(),
  score: z.number().min(0).max(1).nullable(),
  tags: z.array(z.string()).max(5).default([]),
  kind: z.discriminatedUnion("type", [z.object({ type: z.literal("a"), x: z.number().int(), extra: z.string().optional() }), z.object({ type: z.literal("b"), y: z.string() })]),
  either: z.union([z.string(), z.number()]),
  nested: z.object({ deep: z.boolean().optional() }),
  when: z.iso.datetime(),
});

/** Every keyword left anywhere in a schema. */
const keywords = (n: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(n)) n.forEach((x) => keywords(x, out));
  else if (typeof n === "object" && n !== null) {
    for (const [k, v] of Object.entries(n)) {
      out.add(k);
      keywords(k === "properties" && typeof v === "object" && v !== null ? Object.values(v) : v, out);
    }
  }
  return out;
};

describe("strictJsonSchema", () => {
  const s = strictJsonSchema(Shape);

  it("closes every object and lists every key as required; optional keys become nullable", () => {
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["label", "note", "score", "tags", "kind", "either", "nested", "when"]);
    const props = z.record(z.string(), z.unknown()).parse(s.properties);
    expect(props.note).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    expect(props.nested).toEqual({ type: "object", properties: { deep: { anyOf: [{ type: "boolean" }, { type: "null" }] } }, required: ["deep"], additionalProperties: false });
    // A field with a default is optional to the model; zod fills it in.
    expect(props.tags).toEqual({ anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] });
  });

  it("turns oneOf into anyOf, const into a one-value enum, a type list into anyOf, and keeps descriptions", () => {
    const props = z.record(z.string(), z.unknown()).parse(s.properties);
    expect(JSON.stringify(props.kind)).toContain('"anyOf"');
    expect(JSON.stringify(props.kind)).toContain('"enum":["a"]');
    expect(props.either).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(props.label).toEqual({ type: "string", enum: ["lead", "spam", "other"], description: "what the message is" });
  });

  it("leaves no keyword outside the subset both providers accept", () => {
    const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "description"]);
    const left = [...keywords(s)].filter((k) => !allowed.has(k));
    expect(left).toEqual([]);
    for (const k of ["oneOf", "const", "$schema", "default", "pattern", "format", "minimum", "maximum", "maxItems"]) expect(keywords(s).has(k)).toBe(false);
  });

  it("refuses what has no strict form before any request: a non-object root, an open record, a recursive schema", () => {
    expect(() => strictJsonSchema(z.array(z.string()))).toThrow(SchemaError);
    expect(() => strictJsonSchema(z.object({ m: z.record(z.string(), z.number()) }))).toThrow(/open record/);
    type Tree = { name: string; kids: Tree[] };
    const TreeS: z.ZodType<Tree> = z.object({ name: z.string(), get kids() { return z.array(TreeS); } });
    expect(() => strictJsonSchema(z.object({ t: TreeS }))).toThrow(/\$ref/);
  });
});

describe("stripOptionalNulls", () => {
  it("makes a model's null for an optional key a missing key, keeps a nullable null, and follows the union's branch", () => {
    const plain = plainJsonSchema(Shape);
    const answer = { label: "lead", note: null, score: null, tags: null, kind: { type: "a", x: 1, extra: null }, either: 2, nested: { deep: null }, when: "2026-11-20T10:00:00Z" };
    const value = Shape.parse(stripOptionalNulls(answer, plain));
    expect(value).toEqual({ label: "lead", score: null, tags: [], kind: { type: "a", x: 1 }, either: 2, nested: {}, when: "2026-11-20T10:00:00Z" });
  });

  it("bounds dropped from the wire are still enforced by zod locally", () => {
    const plain = plainJsonSchema(Shape);
    const r = Shape.safeParse(stripOptionalNulls({ label: "lead", score: 3, kind: { type: "b", y: "" }, either: "x", nested: {}, when: "yesterday" }, plain));
    expect(r.success).toBe(false);
  });
});

describe("readAnswer", () => {
  it("parses JSON, strips a fence, never repairs a cut answer", () => {
    expect(readAnswer('{"a":1}', "stop")).toEqual({ kind: "json", value: { a: 1 } });
    expect(readAnswer('```json\n{"a":1}\n```', "stop")).toEqual({ kind: "json", value: { a: 1 } });
    expect(readAnswer('{"a":1}', "length")).toEqual({ kind: "truncated" });
    expect(readAnswer("  ", "stop")).toEqual({ kind: "empty" });
    expect(readAnswer("{a:1", "stop").kind).toBe("syntax");
  });
});
