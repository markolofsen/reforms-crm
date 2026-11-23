import { coreUpdateDto, instanceDto } from "@hub/contract/instance";
import type { Operation } from "../http/openapi";

/** The instance domain's JSON operations (P120 W1). `GET /api/instance/logo` is a file, not JSON, and stays out. */
export const operations: Operation[] = [
  { method: "get", path: "/api/instance", operationId: "getInstance", summary: "Read the Hub instance brand", tags: ["meta"], reply: { name: "Instance", schema: instanceDto }, errors: [503] },
  { method: "get", path: "/api/instance/core", operationId: "getCoreUpdate", summary: "Read the cached core update status", tags: ["meta"], reply: { name: "CoreUpdate", schema: coreUpdateDto }, errors: [404, 503] },
  { method: "post", path: "/api/instance/core/check", operationId: "checkCoreUpdate", summary: "Check the origin's tags for a core update now", tags: ["meta"], reply: { name: "CoreUpdate", schema: coreUpdateDto }, errors: [404, 429, 503] },
];
