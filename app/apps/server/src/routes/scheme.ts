import { Hono } from "hono";
import { schemeDto } from "@hub/contract/scheme";
import { composeScheme } from "../scheme";
import type { SchemeServices } from "../composition/capabilities";

/** `GET /api/scheme` (P63 O1): the Hub's parts and how each stands, for Overview's parts table. Read only: it runs no check (`scheme.ts`). */
export function schemeRoutes({ sources }: SchemeServices) {
  return new Hono().get("/api/scheme", async (c) => c.json(schemeDto.parse(await composeScheme(sources))));
}
