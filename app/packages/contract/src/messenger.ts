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

/**
 * Decision 0046 (P132 B1-2): `hub mcp`'s `messenger_send` asks the server to send one messenger draft on the owner's word. It
 * names the chat (the `messenger_chats` row id) and, in the path, the draft; the server finds the word in the session log.
 */
export const agentSendBody = z.strictObject({ chat: z.number().int().positive() });
export type AgentSendBody = z.infer<typeof agentSendBody>;

/** What went out, for the agent's one line to the owner. */
export const agentSentDto = z.strictObject({
  ok: z.literal(true),
  sendId: z.number(),
  channel: z.enum(MESSENGER_CHANNELS),
  chatId: z.string(),
  to: z.string(),
  text: z.string(),
  at: z.string(),
});
export type AgentSentDto = z.infer<typeof agentSentDto>;

/** A refusal of an agent send: the door's reasons in words, a code the agent can act on, and its next step. */
export const agentSendRefusalDto = z.object({
  error: z.string(),
  code: z.string(),
  reason: z.string(),
  next: z.string(),
  refused: z.array(z.string()).optional(),
});
export type AgentSendRefusalDto = z.infer<typeof agentSendRefusalDto>;
