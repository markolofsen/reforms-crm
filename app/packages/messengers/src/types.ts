import type { IdentifierKind, MessengerChannel } from "@hub/db";

export type { IdentifierKind, MessengerChannel };

/**
 * What each channel can do. A Telegram user account sends through the server's send door (P71 M4, decision 0036 point 7: the
 * owner's click, a dry run, a ticket, `send_log` first, the guards). WhatsApp has no send until M5: the owner copies the text.
 */
export const CHANNELS: Record<MessengerChannel, { identifier: IdentifierKind; canSend: boolean }> = {
  telegram_bot: { identifier: "telegram", canSend: true },
  telegram_user: { identifier: "telegram", canSend: true },
  whatsapp: { identifier: "whatsapp", canSend: false },
};

export type SendableChannel = "telegram_bot" | "telegram_user";

export const RETENTION_DAYS = 90;
export const MAX_TEXT = 4096; // Telegram's own message limit

export const canSendVia = (c: MessengerChannel): c is SendableChannel => CHANNELS[c].canSend;

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
