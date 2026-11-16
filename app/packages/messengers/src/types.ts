import type { IdentifierKind, MessengerChannel } from "@hub/db";

export type { IdentifierKind, MessengerChannel };

/** What each channel can do. `canSend` is false for user accounts and WhatsApp: the owner copies the text and opens the chat. */
export const CHANNELS: Record<MessengerChannel, { identifier: IdentifierKind; canSend: boolean }> = {
  telegram_bot: { identifier: "telegram", canSend: true },
  telegram_user: { identifier: "telegram", canSend: false },
  whatsapp: { identifier: "whatsapp", canSend: false },
};

export type SendableChannel = "telegram_bot";

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
