import { z, type ZodType } from "zod";

/** One JSON operation as the server declares it (P120 W1): the contract schemas are the one source of its wire shape. */
export type Operation = {
  method: "get" | "post" | "put" | "patch" | "delete";
  /** Hono's path, `:param` style; the document writes `{param}`. */
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  /** The 200 reply: a component name and its contract schema. */
  reply: { name: string; schema: ZodType };
  /** A JSON body: a component name and its contract schema. */
  body?: { name: string; schema: ZodType };
  /** The refusal statuses this operation states (`{ error, code }`, `@hub/contract/errors`). */
  errors: number[];
};

type Doc = { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown>; responses?: Record<string, unknown> } } & Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonSchema = (s: ZodType) => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io: "output", unrepresentable: "any" }) as Record<string, unknown>;
  return rest;
};
export const openApiPath = (path: string) => path.replace(/:(\w+)/g, "{$1}");
const paramsOf = (path: string) => [...path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));

/** Adds the declared operations to a document (the hand-kept base until P120 W2 deletes it); a path declared twice throws. */
export function withOperations(base: Doc, ops: readonly Operation[]): Doc {
  const doc: Doc = structuredClone(base);
  for (const op of ops) {
    const path = openApiPath(op.path);
    const at = (doc.paths[path] ??= {});
    if (at[op.method]) throw new Error(`${op.method.toUpperCase()} ${path} is declared twice`);
    doc.components.schemas[op.reply.name] = jsonSchema(op.reply.schema);
    if (op.body) doc.components.schemas[op.body.name] = jsonSchema(op.body.schema);
    const params = paramsOf(op.path);
    at[op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      tags: op.tags,
      ...(params.length ? { parameters: params } : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: ref(op.body.name) } } } } : {}),
      responses: {
        "200": { description: op.summary, content: { "application/json": { schema: ref(op.reply.name) } } },
        ...Object.fromEntries(op.errors.map((s) => [String(s), { $ref: "#/components/responses/ApiError" }])),
      },
    };
  }
  return doc;
}
