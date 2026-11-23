import { Hono } from "hono";
import { inboxQuery, notByEmailQuery } from "@hub/contract/requests";
import { inboxDto, notByEmailDto } from "@hub/contract/inbox";
import { v } from "../http/http";
import type { MailContext } from "./context";

/** The triage list: who the agent touched and what it did. Read-only; rows are written by `client_record` and `draft_write`'s record (hub mcp, P129 A3). */
export function inboxRoutes({ repos }: MailContext) {
  return new Hono()
    .get("/api/inbox/not-by-email", v("query", notByEmailQuery), async (c) => {
      const { project, kind, limit, offset } = c.req.valid("query");
      const [rows, counts] = await Promise.all([repos.inbox.notByEmail(project, kind ?? null, { limit, offset }), repos.inbox.kindCounts(project)]);
      const total = kind ? counts[kind] : Object.values(counts).reduce((a, b) => a + b, 0);
      return c.json(notByEmailDto.parse({ rows: rows.map((r) => ({ ...r, owed: false, openDraftId: null })), counts, total }));
    })
    .get("/api/inbox", v("query", inboxQuery), async (c) => {
    const { project, filter, limit, offset } = c.req.valid("query");
    const [rows, counts, lastTriageAt] = await Promise.all([repos.inbox.list(project, filter, { limit, offset }), repos.inbox.counts(project), repos.inbox.lastTriageAt(project)]);
    return c.json(inboxDto.parse({ rows, counts, lastTriageAt, total: counts[filter] }));
  });
}
