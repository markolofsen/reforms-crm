import { Api } from "grammy";
import type { SendingAdapter } from "./adapter";
import { botIdOf } from "./token";
import { createTelegramAdapter, type TelegramApi } from "./telegram";

/** The real grammY client. The only file that imports grammY, so tests and types never touch the network layer. */
export function telegramAdapterFromToken(token: string): SendingAdapter {
  return createTelegramAdapter({ api: new Api(token) as unknown as TelegramApi, botId: botIdOf(token) });
}
