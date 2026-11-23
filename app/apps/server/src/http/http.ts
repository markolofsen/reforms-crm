import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { ZodType } from "zod";
import { sentenceOf } from "@hub/contract/errors";

/**
 * A request validator whose refusal is the one error shape (`{error, code: "invalid"}`, 400), so the admin shows the
 * sentence instead of "Request failed (400)".
 */
export const v = <T extends ZodType>(target: "json" | "query" | "param", schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: sentenceOf(result.error), code: "invalid" as const }, 400);
  });

export const notFound = (c: Context, what: string) => c.json({ error: `${what} not found`, code: "not_found" as const }, 404);
