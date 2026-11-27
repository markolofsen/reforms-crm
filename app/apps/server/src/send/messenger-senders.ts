import type { MessengerChannel } from "@hub/db";
import type { MessengerSenders } from "@hub/messengers/door";
import type { TelegramUserHandle } from "../messengers/accounts/telegram-user";
import type { WhatsAppHandle } from "../messengers/accounts/whatsapp";

/** The one send of each connected messenger account, handed to the send door and nothing else (P71 M4). */
export const messengerSenders = (tg: TelegramUserHandle | undefined, wa: WhatsAppHandle | undefined): MessengerSenders | undefined =>
  tg || wa
    ? {
        publicSender: (account) => tg?.publicSender?.(account),
        sender: (channel, account) => (channel === "telegram_user" ? tg?.sender(account) : channel === "whatsapp" ? wa?.sender(account) : undefined),
        failed: (channel, account, err) => (channel === "telegram_user" ? tg?.sendFailed(account, err) : channel === "whatsapp" ? wa?.sendFailed(account, err) : undefined) ?? Promise.resolve(),
      }
    : undefined;

/**
 * Decision 0048 (P139 A4, verdict 13): the typing status of an account, and nothing else of its adapter. The autopilot's pacing
 * gets this port, never a sender, so the door stays the only caller of `send`. False when the account has no typing status.
 */
export interface MessengerTyping {
  typing(channel: MessengerChannel, account: string, chatId: string): Promise<boolean>;
}

export const messengerTyping = (tg: TelegramUserHandle | undefined, wa: WhatsAppHandle | undefined): MessengerTyping => ({
  typing: async (channel, account, chatId) => {
    const a = channel === "telegram_user" ? tg?.sender(account) : channel === "whatsapp" ? wa?.sender(account) : undefined;
    if (!a?.typing) return false;
    await a.typing(chatId);
    return true;
  },
});
