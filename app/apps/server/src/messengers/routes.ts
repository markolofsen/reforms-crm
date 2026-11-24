import { Hono } from "hono";
import type { MessengersContext } from "./context";
import { messengerRoutes } from "./messengers-routes";
import { telegramUserRoutes } from "./accounts/telegram-user-routes";
import { whatsappRoutes } from "./accounts/whatsapp-routes";
import { autolinkRoutes } from "./autolink/routes";
import { autopilotRoutes } from "./autopilot/routes";

/** Every Messengers route over its one context (P126 S1): accounts, the autolink, the chats, the autopilot's switches (P139). */
export const routes = (ctx: MessengersContext) =>
  new Hono().route("/", telegramUserRoutes(ctx)).route("/", whatsappRoutes(ctx)).route("/", autolinkRoutes(ctx)).route("/", messengerRoutes(ctx)).route("/", autopilotRoutes(ctx));
