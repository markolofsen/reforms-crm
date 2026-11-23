import { liveQuery } from "@hub/contract/live";
import type { Operation } from "../http/openapi";

/** The live stream (P50) is SSE, not JSON: declared for its URL only; `lib/cache/live.ts` opens it with `EventSource`. */
export const operations: Operation[] = [
  { method: "get", path: "/api/live", operationId: "streamLive", summary: "The live topics stream (server-sent events)", tags: ["live"], query: liveQuery, reply: { media: "text/event-stream" }, errors: [404, 503] },
];
