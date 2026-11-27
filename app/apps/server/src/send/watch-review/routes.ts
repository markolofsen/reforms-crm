import { createHash } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { watchActionParam, watchProposalParam, watchReplyResultDto } from "@hub/contract/watch-actions";
import { watchReviewDto, watchReviewListDto, watchReviewListQuery, watchReviewPrepareBody, watchReviewPreparedDto, watchReviewSendBody, watchReviewReconcileBody } from "@hub/contract/watch-review";
import { gateRefusal, ticketStore } from "../../http/admin-gate";
import { notFound, v } from "../../http/http";
import type { SendContext } from "../context";
import { watchActions } from "../watch-actions";

const TICKET_TTL_MS = 60_000;
const ticketSubject = (project: string, proposal: string, payloadHash: string, policyGeneration: string) =>
  "watch-send:" + createHash("sha256").update(JSON.stringify([project, proposal, payloadHash, policyGeneration])).digest("hex");
const refused = (c: Context, reasons: string[]) => c.json({ error: reasons[0] ?? "This public action is unavailable.", code: "wrong_state", refused: reasons }, 409);
const unavailable = (c: Context) => refused(c, ["Public proposal review is unavailable."]);

/** Browser review never creates a proposal or supplies review authority. Existing CLI-token routes remain separate. */
export function watchReviewRoutes(services: SendContext) {
  const actions = watchActions(services);
  const clock = services.sender?.now;
  const tickets = services.sender?.tickets ?? ticketStore({ ttlMs: TICKET_TTL_MS, ...(clock ? { now: () => clock().getTime() } : {}) });
  const owner: MiddlewareHandler = async (c, next) => {
    if (!services.sender) return unavailable(c);
    const reason = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, services.sender.adminPort, { sameSite: true });
    if (reason) return c.json({ error: reason, code: "forbidden" }, 403);
    await next();
  };
  return new Hono()
    .get("/api/projects/:slug/watch/proposals", v("param", watchActionParam), v("query", watchReviewListQuery), async (c) => {
      if (!actions) return unavailable(c);
      const r = await actions.list(c.req.valid("param").slug, c.req.valid("query"));
      return "refused" in r ? refused(c, r.refused) : c.json(watchReviewListDto.parse(r));
    })
    .get("/api/projects/:slug/watch/proposals/:id", v("param", watchProposalParam), async (c) => {
      if (!actions) return unavailable(c);
      const { slug, id } = c.req.valid("param");
      const r = await actions.review(slug, id);
      if (!r) return notFound(c, "public reply proposal");
      return "refused" in r ? refused(c, r.refused) : c.json(watchReviewDto.parse(r));
    })
    .get("/api/projects/:slug/watch/proposals/:id/photo", v("param", watchProposalParam), async (c) => {
      if (!actions) return unavailable(c);
      const { slug, id } = c.req.valid("param");
      const photo = await actions.photo(slug, id);
      if (!photo) return notFound(c, "reviewed photo");
      if ("refused" in photo) return refused(c, photo.refused);
      return c.body(new Uint8Array(photo.bytes).buffer, 200, {
        "Content-Type": photo.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
        "Cross-Origin-Resource-Policy": "same-origin", "Content-Disposition": "inline",
      });
    })
    .post("/api/projects/:slug/watch/proposals/:id/prepare", owner, v("param", watchProposalParam), v("json", watchReviewPrepareBody), async (c) => {
      if (!actions) return unavailable(c);
      const { slug, id } = c.req.valid("param");
      const r = await actions.review(slug, id, true);
      if (!r) return notFound(c, "public reply proposal");
      if ("refused" in r) return refused(c, r.refused);
      const body = c.req.valid("json");
      if (r.proposal.payloadHash !== body.payloadHash) return refused(c, ["The displayed proposal payload changed. Read it again."]);
      if (!r.canPrepare || r.state !== "ready" || !r.currentPolicyGeneration || r.currentPolicyGeneration !== r.proposal.policyGeneration) {
        return refused(c, r.reasons.length ? r.reasons : ["This proposal needs a fresh review or its current action is unavailable."]);
      }
      const ticket = tickets.mint(ticketSubject(slug, id, body.payloadHash, r.currentPolicyGeneration));
      return c.json(watchReviewPreparedDto.parse({ review: r, ...ticket, payloadHash: body.payloadHash, policyGeneration: r.currentPolicyGeneration }));
    })
    .post("/api/projects/:slug/watch/proposals/:id/send", owner, v("param", watchProposalParam), v("json", watchReviewSendBody), async (c) => {
      if (!actions) return unavailable(c);
      const { slug, id } = c.req.valid("param");
      const body = c.req.valid("json");
      // Consume before the async operation. Replayed tickets never reach the existing public send door.
      if (!tickets.take(body.ticket, ticketSubject(slug, id, body.payloadHash, body.policyGeneration))) {
        return c.json({ error: "This confirmation is missing, expired or already used. Review the current status before another action.", code: "forbidden" }, 403);
      }
      const r = watchReplyResultDto.parse(await actions.send(slug, id, body.payloadHash));
      if ("refused" in r) return refused(c, r.refused);
      return c.json(r, r.status === "sent" ? 200 : 202);
    })
    .post("/api/projects/:slug/watch/proposals/:id/reconcile", owner, v("param", watchProposalParam), v("json", watchReviewReconcileBody), async (c) => {
      if (!actions) return unavailable(c);
      const { slug, id } = c.req.valid("param");
      // Receipt inspection cannot deliver. The server supplies its stored id, never a caller's guessed target.
      const r = watchReplyResultDto.parse(await actions.reconcileKnown(slug, id));
      return "refused" in r ? refused(c, r.refused) : c.json(r);
    });
}
