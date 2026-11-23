import { Hono } from "hono";
import type { MailContext } from "./context";
import { bulkRoutes } from "./bulk-routes";
import { conversationRoutes } from "./conversations-routes";
import { draftMailRoutes } from "./draft-mail-routes";
import { draftRoutes } from "./drafts-routes";
import { inboundRoutes } from "./inbound-routes";
import { inboxRoutes } from "./inbox-routes";
import { manualDraftRoutes } from "./manual-draft-routes";

/** Every Mail route over its one context (P126 S1). */
export const routes = (ctx: MailContext) =>
  new Hono()
    .route("/", draftRoutes(ctx))
    .route("/", draftMailRoutes(ctx))
    .route("/", manualDraftRoutes(ctx))
    .route("/", inboxRoutes(ctx))
    .route("/", inboundRoutes(ctx))
    .route("/", conversationRoutes(ctx))
    .route("/", bulkRoutes(ctx));
