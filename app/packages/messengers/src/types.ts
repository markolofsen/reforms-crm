import type { IdentifierKind, MessengerChannel } from "@hub/db";

export type { IdentifierKind, MessengerChannel };

/**
 * Each channel's identifier kind. Every channel sends through the server's send door (P71 M4 and M5, decision 0036 point 7: the
 * owner's click, a dry run, a ticket, `send_log` first, the guards); the agent never does.
 */
export const CHANNELS: Record<MessengerChannel, { identifier: IdentifierKind }> = {
  telegram_bot: { identifier: "telegram" },
  telegram_user: { identifier: "telegram" },
  whatsapp: { identifier: "whatsapp" },
};

/** The cache's TTL (decision 0049 point 1) where no read-through refills it yet: Telegram until P141 U1, WhatsApp while the Mac's app is unreadable. */
export const RETENTION_DAYS = 90;
/** WhatsApp's cache TTL while the Mac's WhatsApp app can refill a chat (decision 0049 points 1 and 4). */
export const WA_CACHE_DAYS = 30;
export const MAX_TEXT = 4096; // Telegram's own message limit

/** Channels whose chats are linked with this identifier kind. */
export const channelsOf = (kind: IdentifierKind): MessengerChannel[] =>
  (Object.keys(CHANNELS) as MessengerChannel[]).filter((c) => CHANNELS[c].identifier === kind);

/** An outbound reply nobody has approved. This is all an agent can make. */
export interface Draft {
  readonly state: "draft";
  readonly id: number;
  readonly project: string;
  readonly channel: MessengerChannel;
  readonly chatId: string;
  readonly text: string;
  readonly clientId: number | null;
}
