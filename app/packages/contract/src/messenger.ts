import { MESSENGER_TEXT_MAX } from "@hub/config/chat-rules";
import { z } from "zod";

export const MESSENGER_CHANNELS = ["telegram_bot", "telegram_user", "whatsapp"] as const;
export type MessengerChannelDto = (typeof MESSENGER_CHANNELS)[number];

/** The dry run for a Messenger send door. It contains no ticket and sends nothing. */
export const messengerSendPreviewDto = z.strictObject({
  ok: z.literal(true),
  dryRun: z.literal(true),
  channel: z.enum(MESSENGER_CHANNELS),
  chatId: z.string(),
  account: z.string(),
  to: z.string(),
  text: z.string(),
});
export type MessengerSendPreviewDto = z.infer<typeof messengerSendPreviewDto>;

/** The owner-confirmed Messenger send request, outside the panel read contract. */
export const messengerSendBody = z.discriminatedUnion("apply", [
  z.strictObject({ apply: z.literal(false) }),
  z.strictObject({
    apply: z.literal(true),
    confirm: z.strictObject({ chatId: z.string().min(1).max(64), text: z.string().min(1).max(MESSENGER_TEXT_MAX) }),
    ticket: z.string().min(1).max(200).optional(),
  }),
]);
export type MessengerSendBody = z.infer<typeof messengerSendBody>;
