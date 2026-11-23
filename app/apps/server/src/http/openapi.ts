import { z, type ZodType } from "zod";
import { apiError } from "@hub/contract/errors";

type Named = { name: string; schema: ZodType };
type Shape = { shape: Record<string, ZodType> };

/**
 * One operation as the server declares it (P120 W1-W2): the contract schemas are the one source of its wire shape, and
 * `<domain>/openapi.ts` lists it beside the domain's routes. `http/openapi.test.ts` ties every declared operation to a route.
 */
export type Operation = {
  method: "get" | "post" | "put" | "patch" | "delete";
  /** Hono's path, `:param` style; the document writes `{param}`. */
  path: string;
  operationId: string;
  summary: string;
  /** One tag: Orval writes one file per tag (`src/generated/<tag>/<tag>.ts`). */
  tags: [string];
  /** The route's own `v("param", …)` schema; a path parameter it does not name is a string. */
  params?: Shape;
  /** The route's own query schema. */
  query?: Shape;
  /** A JSON body (a component name and its contract schema), or a multipart form of one repeated file field. */
  body?: Named | { form: string };
  /** The JSON reply, or a stream or file (`media`), which the admin reaches only through the operation's URL helper. */
  reply: Named | { media: string };
  /** The success statuses (200 when absent). */
  status?: number[];
  /** The refusal statuses this operation states (`{ error, code }`, `@hub/contract/errors`). */
  errors: number[];
};

export type Doc = { openapi: string; info: Record<string, unknown>; servers: unknown[]; paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown>; responses: Record<string, unknown> } };

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonSchema = (s: ZodType, io: "input" | "output") => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io, unrepresentable: "any" }) as Record<string, unknown>;
  return rest;
};
export const openApiPath = (path: string) => path.replace(/:(\w+)/g, "{$1}");
const optional = (s: ZodType) => s.safeParse(undefined).success;

function parameters(op: Operation) {
  const path = [...op.path.matchAll(/:(\w+)/g)].map((m) => m[1] as string);
  const params = path.map((name) => {
    const s = op.params?.shape[name];
    return { name, in: "path", required: true, schema: s ? jsonSchema(s, "output") : { type: "string" } };
  });
  const query = Object.entries(op.query?.shape ?? {}).map(([name, s]) => ({ name, in: "query", required: !optional(s), schema: jsonSchema(s, "output") }));
  return [...params, ...query];
}

/** The whole document Orval reads, from the declared operations alone (P120 W2: no hand-kept base); a path or a component declared twice with another shape throws. */
export function openApiDocument(ops: readonly Operation[]): Doc {
  const doc: Doc = {
    openapi: "3.1.0",
    info: { title: "Hub Admin API", version: "0.2.0", description: "Emitted by the server from its declared operations and the @hub/contract schemas (P120). Streams and files are declared for their URL only." },
    servers: [{ url: "/" }],
    paths: {},
    components: { schemas: { ApiError: jsonSchema(apiError, "output") }, responses: { ApiError: { description: "A typed Hub refusal", content: { "application/json": { schema: ref("ApiError") } } } } },
  };
  const put = (name: string, schema: ZodType, io: "input" | "output") => {
    const json = jsonSchema(schema, io);
    const had = doc.components.schemas[name];
    if (had && JSON.stringify(had) !== JSON.stringify(json)) throw new Error(`component ${name} is declared twice with two shapes`);
    doc.components.schemas[name] = json;
    return ref(name);
  };
  const ids = new Set<string>();
  for (const op of ops) {
    if (ids.has(op.operationId)) throw new Error(`operation ${op.operationId} is declared twice`);
    ids.add(op.operationId);
    const path = openApiPath(op.path);
    const at = (doc.paths[path] ??= {});
    if (at[op.method]) throw new Error(`${op.method.toUpperCase()} ${path} is declared twice`);
    const params = parameters(op);
    const body = !op.body
      ? undefined
      : "form" in op.body
        ? { "multipart/form-data": { schema: { type: "object", properties: { [op.body.form]: { type: "array", items: { type: "string", format: "binary" } } } } } }
        : { "application/json": { schema: put(op.body.name, op.body.schema, "input") } };
    const content = "media" in op.reply ? { [op.reply.media]: { schema: { type: "string" } } } : { "application/json": { schema: put(op.reply.name, op.reply.schema, "output") } };
    at[op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      tags: op.tags,
      ...(params.length ? { parameters: params } : {}),
      ...(body ? { requestBody: { required: true, content: body } } : {}),
      responses: {
        ...Object.fromEntries((op.status ?? [200]).map((s) => [String(s), { description: op.summary, content }])),
        ...Object.fromEntries(op.errors.map((s) => [String(s), { $ref: "#/components/responses/ApiError" }])),
      },
    };
  }
  return doc;
}
