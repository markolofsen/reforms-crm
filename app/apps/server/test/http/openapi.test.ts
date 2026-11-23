import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Repos } from "@hub/db";
import { NOT_DECLARED, OPERATIONS } from "../../src/composition/operations";
import { testApp } from "../support/runtime";
import { emittedDocument } from "../../src/http/emitted";
import { openApiDocument, type Operation } from "../../src/http/openapi";

const api = (f: string) => fileURLToPath(new URL(`../../../../packages/api/${f}`, import.meta.url));
const key = (method: string, path: string) => `${method.toLowerCase()} ${path}`;

// P120 W1-W2: the server's declared operations are the OpenAPI document; nothing is kept by hand.
describe("the server emits its OpenAPI document", () => {
  const routes = new Set(testApp({} as Repos).routes.filter((r) => r.path.startsWith("/api/")).map((r) => key(r.method, r.path)));
  it("every declared operation is a route of the app", () => {
    for (const op of OPERATIONS) expect(routes.has(key(op.method, op.path)), key(op.method, op.path)).toBe(true);
  });
  it("every /api route is declared or named in NOT_DECLARED with its reason", () => {
    const declared = new Set(OPERATIONS.map((op) => key(op.method, op.path)));
    expect([...routes].filter((r) => !declared.has(r) && !(r in NOT_DECLARED))).toEqual([]);
    expect(Object.keys(NOT_DECLARED).filter((r) => declared.has(r) || !routes.has(r))).toEqual([]);
  });
  it("openapi.json is fresh: the emitted document, byte for byte", () => {
    expect(readFileSync(api("openapi.json"), "utf8")).toBe(`${JSON.stringify(emittedDocument(), null, 2)}\n`);
  });
  it("no hand-kept base and no generated Zod remain", () => {
    expect(existsSync(api("openapi.base.json"))).toBe(false);
    expect(existsSync(api("src/generated-zod"))).toBe(false);
  });
});

describe("openApiDocument", () => {
  const base: Operation = { method: "get", path: "/api/x/:id", operationId: "getX", summary: "x", tags: ["meta"], reply: { name: "X", schema: z.object({ a: z.string() }) }, errors: [404] };
  it("types path parameters from the route's schema and marks optional query fields", () => {
    const doc = openApiDocument([{ ...base, params: z.object({ id: z.coerce.number().int() }), query: z.object({ project: z.string(), limit: z.number().default(1), q: z.string().optional() }) }]);
    const op = doc.paths["/api/x/{id}"]?.get as { parameters: { name: string; in: string; required: boolean; schema: { type: string } }[] };
    expect(op.parameters.map((p) => [p.name, p.in, p.required])).toEqual([["id", "path", true], ["project", "query", true], ["limit", "query", false], ["q", "query", false]]);
    expect(op.parameters[0]?.schema.type).toBe("integer");
  });
  it("throws on an operation id or a component declared twice with two shapes", () => {
    expect(() => openApiDocument([base, { ...base, path: "/api/y" }])).toThrow(/getX/);
    expect(() => openApiDocument([base, { ...base, operationId: "getY", path: "/api/y", reply: { name: "X", schema: z.object({ b: z.number() }) } }])).toThrow(/X/);
  });
  it("declares a stream or a file for its URL only, and a form body as multipart", () => {
    const doc = openApiDocument([{ ...base, reply: { media: "text/event-stream" }, body: { form: "file" }, method: "post", status: [201] }]);
    const op = doc.paths["/api/x/{id}"]?.post as { requestBody: { content: Record<string, unknown> }; responses: Record<string, { content?: Record<string, unknown> }> };
    expect(Object.keys(op.requestBody.content)).toEqual(["multipart/form-data"]);
    expect(Object.keys(op.responses["201"]?.content ?? {})).toEqual(["text/event-stream"]);
  });
});
