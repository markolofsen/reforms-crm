import { Hono } from "hono";
import { livePointer, resolveRef } from "@hub/agent/focus";
import { pointerDto } from "@hub/contract/pointer";
import type { Repos } from "@hub/db";

/**
 * `GET /api/pointer` (P72, decision 0038): the agent's live pointer, which `highlight` in `hub mcp` wrote to
 * `state/pointer.json`, with each ref's title resolved inside the pointer's own project (null: it names nothing there). The
 * admin reads it when the live topic `pointer` moves. Read only, behind the general guard like every GET: the pointer flows
 * from the agent to the admin, so this GET is the pointer's alone; the focus still has none (decision 0029). The admin never
 * writes the pointer. Without a file path the route answers "no pointer".
 */
export function pointerRoutes(repos: Repos, file: string | undefined, now: () => Date) {
  return new Hono().get("/api/pointer", async (c) => {
    const at = now();
    const p = file ? livePointer(file, at) : null;
    if (!p) return c.json(pointerDto.parse({ pointer: null }));
    const ctx = { repos, slug: p.project, today: at.toISOString().slice(0, 10) };
    const targets = await Promise.all(p.refs.map(async (ref) => ({ ref, title: (await resolveRef(ctx, ref))?.title ?? null })));
    return c.json(pointerDto.parse({ pointer: { id: p.id, project: p.project, targets, note: p.note, expiresAt: p.expiresAt } }));
  });
}
