import { Hono } from "hono";
import type { Repos } from "@hub/db";
import { agentFeedDto } from "@hub/contract/agent-feed";
import { feedOf, tailEvents } from "@hub/log/feed";
import type { LogStore } from "@hub/log/store";
import { notFound } from "../http";

/**
 * `GET /api/projects/:slug/agent-feed` (P59): the last five things the agent did in the project, the tone of each turn that
 * ended, and whether it waits on the owner, read from the tail of the session log (`@hub/log/feed`, labels computed there).
 * Read only, behind the general guard (loopback Host and Origin); the reply's one text field is the label. The live topic
 * `agent-log` says when to read it again. Without a log store the route is 404.
 */
export function agentFeedRoutes(repos: Repos, store: LogStore | undefined, now: () => Date) {
  return new Hono().get("/api/projects/:slug/agent-feed", async (c) => {
    if (!store) return c.json({ error: "agent feed not set up", code: "not_found" as const }, 404);
    const slug = c.req.param("slug");
    if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
    const at = now();
    return c.json(agentFeedDto.parse(feedOf(tailEvents(store, slug, at), at)));
  });
}
