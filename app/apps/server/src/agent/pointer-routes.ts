import { Hono } from "hono";
import { livePointer, resolveRef } from "@hub/agent/focus";
import { parseRef } from "@hub/contract/focus";
import { pointerDto } from "@hub/contract/pointer";
import type { Repos } from "@hub/db";
import type { AgentContext } from "./context";

/**
 * `GET /api/pointer` (P72, decision 0038): the agent's live pointer, which `highlight` in `hub mcp` wrote to
 * `state/pointer.json`, with each ref's title resolved inside the pointer's own project (null: it names nothing there). The
 * admin reads it when the live topic `pointer` moves. Read only, behind the general guard like every GET: the pointer flows
 * from the agent to the admin, so this GET is the pointer's alone; the focus still has none (decision 0029). The admin never
 * writes the pointer. Without a file path the route answers "no pointer".
 */
/** P99: a draft and a message of theirs are shown in their client's conversation; the ref of that screen, else null. */
async function whereOf(repos: Repos, slug: string, ref: string): Promise<string | null> {
  const p = parseRef(ref);
  const id = p ? Number(p.id) : NaN;
  if (!p || !Number.isInteger(id)) return null;
  if (p.kind === "draft") {
    const d = await repos.drafts.get(id);
    return d && d.project === slug ? `client:${d.clientId}` : null;
  }
  if (p.kind === "inbound") {
    const r = await repos.inboundMail.get(slug, id);
    const clientId = r ? await repos.clients.idByEmail(slug, r.email) : undefined;
    return clientId === undefined ? null : `client:${clientId}`;
  }
  return null;
}

export function pointerRoutes({ repos, pointerFile: file, now }: AgentContext) {
  return new Hono().get("/api/pointer", async (c) => {
    const at = now();
    const p = file ? livePointer(file, at) : null;
    if (!p) return c.json(pointerDto.parse({ pointer: null }));
    const ctx = { repos, slug: p.project, today: at.toISOString().slice(0, 10) };
    const targets = await Promise.all(p.refs.map(async (ref) => ({ ref, title: (await resolveRef(ctx, ref))?.title ?? null, where: await whereOf(repos, p.project, ref).catch(() => null) })));
    return c.json(pointerDto.parse({ pointer: { id: p.id, project: p.project, targets, note: p.note, expiresAt: p.expiresAt } }));
  });
}
