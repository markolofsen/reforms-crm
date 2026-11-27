import { Hono, type MiddlewareHandler } from "hono";
import { AGENT_SEND_HEADER, tokenMatches } from "@hub/agent/send-token";
import { watchActionParam, watchActionQuery, watchProposalBody, watchProposalParam, watchReplyBody, watchReconcileBody, watchReplyContextDto, watchProposalDto, watchReplyResultDto } from "@hub/contract/watch-actions";
import { v, notFound } from "../http/http";
import type { SendContext } from "./context";
import { watchActions } from "./watch-actions";

/** A supported local CLI door under a protected owner grant. Browser/inbound workers have no route into it. */
export function watchActionRoutes(services: SendContext) {
  const actions = watchActions(services);
  const app = new Hono();
  const authorized: MiddlewareHandler = async (c, next) => {
    const token = services.sender?.agent?.token;
    if (!token || !tokenMatches(c.req.header(AGENT_SEND_HEADER), token)) return c.json({ error: "Only the supported local Watch CLI can request public actions.", code: "forbidden" }, 403);
    await next();
  };
  return app
    .get("/api/projects/:slug/watch/actions/context", authorized, v("param", watchActionParam), v("query", watchActionQuery), async (c) => {
      if (!actions) return c.json({ error: "Public reply actions are unavailable.", code: "wrong_state" }, 409);
      const { slug } = c.req.valid("param");
      const q = c.req.valid("query");
      const r = await actions.context(slug, q.direction, q.group, q.messageId);
      return "refused" in r ? c.json(r, 409) : c.json(watchReplyContextDto.parse(r));
    })
    .post("/api/projects/:slug/watch/actions/proposals", authorized, v("param", watchActionParam), v("json", watchProposalBody), async (c) => {
      if (!actions) return c.json({ error: "Public reply actions are unavailable.", code: "wrong_state" }, 409);
      const { slug } = c.req.valid("param");
      const r = await actions.propose(slug, c.req.valid("json"));
      if ("refused" in r) return c.json(r, 409);
      const p = await actions.get(slug, r.proposal.id);
      return c.json(watchProposalDto.parse(p), 201);
    })
    .get("/api/projects/:slug/watch/actions/proposals/:id", authorized, v("param", watchProposalParam), async (c) => {
      if (!actions) return c.json({ error: "Public reply actions are unavailable.", code: "wrong_state" }, 409);
      const { slug, id } = c.req.valid("param");
      const p = await actions.get(slug, id);
      return p ? c.json(watchProposalDto.parse(p)) : notFound(c, "public reply proposal");
    })
    .post("/api/projects/:slug/watch/actions/proposals/:id/send", authorized, v("param", watchProposalParam), v("json", watchReplyBody), async (c) => {
      if (!actions) return c.json({ error: "Public reply actions are unavailable.", code: "wrong_state" }, 409);
      const { slug, id } = c.req.valid("param");
      const body = c.req.valid("json");
      const r = watchReplyResultDto.parse(await actions.send(slug, id, "payloadHash" in body ? body.payloadHash : body.textHash));
      return c.json(r, "refused" in r ? 409 : r.status === "sent" ? 200 : 202);
    })
    .post("/api/projects/:slug/watch/actions/proposals/:id/reconcile", authorized, v("param", watchProposalParam), v("json", watchReconcileBody), async (c) => {
      if (!actions) return c.json({ error: "Public reply actions are unavailable.", code: "wrong_state" }, 409);
      const { slug, id } = c.req.valid("param");
      const r = watchReplyResultDto.parse(await actions.reconcile(slug, id, c.req.valid("json").messageId));
      return c.json(r, "refused" in r ? 409 : 200);
    });
}
