import type { MessengerSenders } from "@hub/messengers/door";
import type { TelegramUserHandle } from "../messengers/accounts/telegram-user";
import type { WhatsAppHandle } from "../messengers/accounts/whatsapp";

/** The one send of each connected messenger account, handed to the send door and nothing else (P71 M4). */
export const messengerSenders = (tg: TelegramUserHandle | undefined, wa: WhatsAppHandle | undefined): MessengerSenders | undefined =>
  tg || wa
    ? {
        sender: (channel, account) => (channel === "telegram_user" ? tg?.sender(account) : channel === "whatsapp" ? wa?.sender(account) : undefined),
        failed: (channel, account, err) => (channel === "telegram_user" ? tg?.sendFailed(account, err) : channel === "whatsapp" ? wa?.sendFailed(account, err) : undefined) ?? Promise.resolve(),
      }
    : undefined;
