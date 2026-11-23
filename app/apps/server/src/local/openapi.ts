import { z } from "zod";
import { appsDto, isServerAction, LOCAL_ACTION_IDS, LOCAL_ACTIONS, localOpenedDto } from "@hub/contract/local";
import type { Operation } from "../http/openapi";

// The server-side Opens of the one registry (P61): the action is the path, its own `args` schema the body.
const serverIds = LOCAL_ACTION_IDS.filter(isServerAction);
const localParam = z.object({ action: z.enum(serverIds as [string, ...string[]]) });
const localArgs = z.union(serverIds.map((id) => LOCAL_ACTIONS[id].args) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);

/** The local bridge (P61, P131): it opens a folder, a file or an app on this Mac and changes nothing in the Hub. */
export const operations: Operation[] = [
  { method: "post", path: "/api/instance/apps/check", operationId: "checkApps", summary: "Check which destination apps this Mac has", tags: ["meta"], reply: { name: "Apps", schema: appsDto }, errors: [403, 404] },
  { method: "post", path: "/api/local/:action", operationId: "openLocal", summary: "Open one registry action on this Mac", tags: ["meta"], params: localParam, body: { name: "LocalArgs", schema: localArgs }, reply: { name: "LocalOpened", schema: localOpenedDto }, errors: [400, 403, 404, 429, 500, 501] },
];
