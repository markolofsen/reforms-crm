import { Hono } from "hono";
import { agentFeedDto } from "@hub/contract/agent-feed";
import { feedOf, tailEvents } from "@hub/log/feed";
import { notFound } from "../http";
import type { AgentFeedServices } from "../composition/capabilities";

/**
 * `GET /api/projects/:slug/agent-feed` (P59): the tone of each turn that ended and whether the agent waits on the owner,
 * read from the tail of the session log (`@hub/log/feed`). Since P73 no row or label: the reply has no text field.
 * Read only, behind the general guard (loopback Host and Origin). The live topic
 * `agent-log` says when to read it again. Without a log store the route is 404.
 */
export function agentFeedRoutes({ repos, store, now }: AgentFeedServices) {
  return new Hono().get("/api/projects/:slug/agent-feed", async (c) => {
    if (!store) return c.json({ error: "agent feed not set up", code: "not_found" as const }, 404);
    const slug = c.req.param("slug");
    if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
    const at = now();
    return c.json(agentFeedDto.parse(feedOf(tailEvents(store, slug, at), at)));
  });
}
