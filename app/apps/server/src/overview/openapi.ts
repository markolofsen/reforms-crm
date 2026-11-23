import { healthDto, pulseDto } from "@hub/contract/health";
import { overviewDto } from "@hub/contract/overview";
import { schemeDto } from "@hub/contract/scheme";
import type { Operation } from "../http/openapi";

/** The overview domain's reads (P120 W2). `GET /api/health` is the doctor's and the CLI's, and the admin's Overview reads it too. */
export const operations: Operation[] = [
  { method: "get", path: "/api/health", operationId: "getHealth", summary: "Read the server's health", tags: ["meta"], reply: { name: "Health", schema: healthDto }, errors: [503] },
  { method: "get", path: "/api/pulse", operationId: "getPulse", summary: "Read the data version and server time", tags: ["meta"], reply: { name: "Pulse", schema: pulseDto }, errors: [503] },
  { method: "get", path: "/api/overview", operationId: "getOverview", summary: "Read the instance overview", tags: ["meta"], reply: { name: "Overview", schema: overviewDto }, errors: [503] },
  { method: "get", path: "/api/scheme", operationId: "getScheme", summary: "Read the Help scheme", tags: ["meta"], reply: { name: "Scheme", schema: schemeDto }, errors: [503] },
];
