import { z } from "zod";

/**
 * P135 K2: one client's map as the conversation pane's Map sheet reads it (`GET /api/projects/:slug/clients/:id/map`). `source` is
 * the Mermaid text the agent last drew (checked by the server before it was saved), null until the first one; `previous` the
 * version before it. The admin draws it; nothing here is Notion's.
 */
export const clientMapDto = z.object({
  clientId: z.number().int().positive(),
  name: z.string(),
  source: z.string().nullable(),
  updatedAt: z.string().nullable(),
  previous: z.object({ source: z.string(), at: z.string() }).nullable(),
  versions: z.number().int().nonnegative(),
});
export type ClientMapDto = z.infer<typeof clientMapDto>;
