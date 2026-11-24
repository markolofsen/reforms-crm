import { z } from "zod";

/**
 * P135 K2: one client's map as the conversation pane's Map sheet reads it (`GET /api/projects/:slug/clients/:id/map`). `source` is
 * the Mermaid text the agent last drew (checked by the server before it was saved), null until the first one; `previous` the
 * version before it. The admin draws it; nothing here is Notion's.
 * P136: `sources` (node id -> the messages or days it rests on) and `reasons` (node id -> why the last redraw removed or renamed
 * it) are the current version's, null for a version drawn before P136.
 */
export const clientMapDto = z.object({
  clientId: z.number().int().positive(),
  name: z.string(),
  email: z.string(),
  source: z.string().nullable(),
  updatedAt: z.string().nullable(),
  previous: z.object({ source: z.string(), at: z.string() }).nullable(),
  versions: z.number().int().nonnegative(),
  sources: z.record(z.string(), z.array(z.string())).nullable(),
  reasons: z.record(z.string(), z.string()).nullable(),
});
export type ClientMapDto = z.infer<typeof clientMapDto>;

/**
 * P136 Q7 (verdict 7f): Overview's "Where we are stuck" for one project (`GET /api/projects/:slug/client-maps/stuck`): each client
 * whose map has a `blocked` node or a `waiting` one of 7 days or more, with those nodes and since when (the oldest version of the
 * unbroken run). Most stuck first: blocked, then the longest wait.
 */
export const stuckNodeDto = z.object({ id: z.string(), label: z.string(), state: z.enum(["blocked", "waiting"]), since: z.string() });
export const stuckClientDto = z.object({ clientId: z.number().int().positive(), name: z.string(), email: z.string(), nodes: z.array(stuckNodeDto).min(1) });
export const stuckClientsDto = z.object({ project: z.string(), waitingDays: z.number().int().positive(), clients: z.array(stuckClientDto) });
export type StuckClientsDto = z.infer<typeof stuckClientsDto>;
export type StuckClientDto = z.infer<typeof stuckClientDto>;
