import { REPLY_MODE_LABELS } from "@hub/config/chat-rules";
import { cut } from "../../mcp/result";
import type { Resolver } from "./types";

const KIND = { telegram_bot: "telegram", telegram_user: "telegram", whatsapp: "whatsapp" } as const;
const CHANNEL = { telegram_bot: "Telegram bot", telegram_user: "Telegram", whatsapp: "WhatsApp" } as const;

/**
 * `chat:7` (P71 M3): a messenger chat, by its row id, as the Messengers panel names it: the client and the channel, its reply mode
 * as the status; read with `messenger_history`. Another project's chat names nothing. P141 U4: a known chat that is not linked is
 * one the owner pointed at himself; it is named with the status "not linked" (the history then needs his words, decision 0049).
 */
export const chat: Resolver = async ({ repos, slug }, id) => {
  const row = await repos.messengers.chatById(slug, Number(id));
  if (!row) return null;
  const clientId = await repos.messengers.clientByIdentifier(slug, KIND[row.channel], row.chatId);
  const c = clientId === null ? null : await repos.clients.get(slug, clientId);
  const who = c ? c.name || c.email : (row.title ?? `chat ${row.chatId}`);
  return { title: cut(`${who} · ${CHANNEL[row.channel]}`), status: clientId === null ? "not linked" : REPLY_MODE_LABELS[row.replyMode], read: { server: "hub", tool: "messenger_history", args: { channel: row.channel, chat_id: row.chatId } } };
};

/** `mdraft:12` (P71 M3): a messenger draft, by its row id: the client, the channel and the start of its text; read with `messenger_history` of its chat. */
export const mdraft: Resolver = async ({ repos, slug }, id) => {
  const d = await repos.messengers.getDraft(slug, Number(id));
  if (!d) return null;
  const row = await repos.messengers.chat(slug, d.channel, d.chatId);
  if (!row) return null;
  const c = d.clientId === null ? null : await repos.clients.get(slug, d.clientId);
  const who = c ? c.name || c.email : (row.title ?? `chat ${row.chatId}`);
  return { title: cut(`${who} · ${CHANNEL[d.channel]} draft · ${d.text.replace(/\s+/g, " ").slice(0, 60)}`), status: d.status, read: { server: "hub", tool: "messenger_history", args: { channel: d.channel, chat_id: d.chatId } } };
};
