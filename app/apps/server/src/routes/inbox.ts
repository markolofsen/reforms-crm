import { Hono } from "hono";
import type { Repos } from "@hub/db";
import { inboxQuery } from "@hub/contract/requests";
import { inboxDto } from "@hub/contract/responses";
import { v } from "../http";

/** The triage list: who the agent touched and what it did. Read-only; rows are written by `hub record-client` and `hub record-draft`. */
export function inboxRoutes(repos: Repos) {
  return new Hono().get("/api/inbox", v("query", inboxQuery), async (c) => {
    const { project, filter, limit, offset } = c.req.valid("query");
    const [rows, counts, lastTriageAt] = await Promise.all([repos.inbox.list(project, filter, { limit, offset }), repos.inbox.counts(project), repos.inbox.lastTriageAt(project)]);
    return c.json(inboxDto.parse({ rows, counts, lastTriageAt, total: counts[filter] }));
  });
}
