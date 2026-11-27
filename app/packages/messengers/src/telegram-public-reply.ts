import { Long, type tl } from "@mtcute/core";
import type { TelegramClient, Message } from "@mtcute/node";
import { assertPublicAuthorized, textHash } from "./authorization";
import { PublicReplyError, publicReplyError, type PublicReplyReceipt, type PublicReplySender } from "./public-reply";
import type { MtPublicTarget } from "./telegram-user";

const receiptOf = (m: Message): PublicReplyReceipt => ({
  messageId: m.id, chatId: m.chat.id, text: m.text, outgoing: m.isOutgoing, at: m.date.toISOString(),
  replyToMessageId: m.replyToMessage?.origin === "same_chat" ? m.replyToMessage.id : null,
  threadId: m.replyToMessage?.threadId ?? null,
});

/** The same signed-in mtcute connection. No implicit channel comment retarget, paid send, send-as, media or retry. */
export function telegramPublicSender(tg: TelegramClient, inputOf: (t: MtPublicTarget) => tl.TypeInputPeer | number): PublicReplySender {
  const receipt = async (target: MtPublicTarget, messageId: number): Promise<PublicReplyReceipt | null> => {
    const [m] = await tg.getMessages(inputOf(target), messageId);
    return m && m.chat.id === target.id ? receiptOf(m) : null;
  };
  return {
    async inspect(target, messageId) {
      const peer = inputOf(target);
      const chat = await tg.getFullChat(peer);
      const kind = chat.chatType === "group" || chat.chatType === "supergroup" ? "group" : "channel";
      if (chat.id !== target.id) throw new PublicReplyError("refused", "PEER_CHANGED");
      const member = kind === "group" ? await tg.getChatMember({ chatId: peer, userId: "self" }) : null;
      const admin = member?.status === "admin" || member?.status === "creator";
      const isMember = chat.isMember && !!member && member.status !== "left" && member.status !== "banned" && (member.status !== "restricted" || member.isMember);
      const own = member?.restrictions ?? chat.permissions;
      const ownAllowed = own === null || (own.canSendMessages && own.canSendText);
      const defaults = chat.defaultPermissions;
      const defaultAllowed = admin || defaults === null || (defaults.canSendMessages && defaults.canSendText);
      const canSendText = kind === "group" && !chat.isMin && isMember && ownAllowed && defaultAllowed;
      const ids = [...new Set([messageId, ...(chat.pinnedMsgId ? [chat.pinnedMsgId] : [])])];
      const messages = await tg.getMessages(peer, ids);
      const source = messages.find((m) => m?.id === messageId && m.chat.id === target.id) ?? null;
      const pin = chat.pinnedMsgId ? messages.find((m) => m?.id === chat.pinnedMsgId && m.chat.id === target.id) ?? null : null;
      // A hidden/unreadable pin makes rules incomplete: a reviewer cannot attest a snapshot we did not fetch.
      const pinMissing = chat.pinnedMsgId !== null && pin === null;
      return {
        chatId: chat.id, username: chat.username?.toLowerCase() ?? null, kind, isMember,
        canSendText: canSendText && !pinMissing,
        refusal: kind !== "group" ? "BROADCAST_OR_UNSUPPORTED_CHAT" : !isMember ? "NOT_A_MEMBER" : !canSendText ? "TEXT_NOT_PERMITTED" : pinMissing ? "RULES_NOT_READABLE" : null,
        slowmodeUntil: chat.slowmodeNextSendDate?.toISOString() ?? null,
        source: source ? { id: source.id, at: source.date.toISOString(), text: source.text,
          replyToMessageId: source.replyToMessage?.origin === "same_chat" ? source.replyToMessage.id : null,
          threadId: source.replyToMessage?.threadId ?? null, outgoing: source.isOutgoing, service: source.isService } : null,
        rules: { description: chat.bio, pinned: pin ? { id: pin.id, text: pin.text } : null, latestPinOnly: true },
      };
    },
    receipt,
    async send(authorization) {
      assertPublicAuthorized(authorization);
      if (authorization.textHash !== textHash(authorization.text)) throw new PublicReplyError("refused", "DRAFT_CHANGED");
      const target = { id: authorization.chatId, accessHash: authorization.accessHash };
      let knownId: number | null = null;
      try {
        const sent = await tg.sendText(inputOf(target), authorization.text, {
          replyTo: authorization.replyToMessageId, mustReply: true,
          ...(authorization.threadId !== null ? { threadId: authorization.threadId } : {}),
          randomId: Long.fromString(authorization.randomId), disableWebPreview: true,
          abortSignal: AbortSignal.timeout(20_000),
        });
        knownId = sent.id;
        // Read the provider's saved message: a synthetic SDK short update alone is not our receipt.
        const saved = await receipt(target, sent.id);
        if (!saved) throw new PublicReplyError("uncertain", "RECEIPT_NOT_READABLE", null, sent.id);
        return saved;
      } catch (error) {
        const safe = publicReplyError(error);
        if (knownId !== null) throw new PublicReplyError("uncertain", safe.code, safe.retryAfterSeconds, knownId);
        // sendText may fetch peer metadata after messages.sendMessage succeeded. A read-side 4xx/FLOOD_WAIT
        // therefore cannot prove non-delivery. Only send-specific rejections are definitive before a receipt id.
        const definitelyRejected = /^(CHAT_WRITE_FORBIDDEN|CHAT_SEND_PLAIN_FORBIDDEN|CHAT_RESTRICTED|CHAT_GUEST_SEND_FORBIDDEN|TOPIC_CLOSED|TOPIC_DELETED|REPLY_MESSAGE_ID_INVALID|SLOWMODE_WAIT_[0-9]+|ALLOW_PAYMENT_REQUIRED|REPLY_MESSAGE_MISSING)$/.test(safe.code);
        throw definitelyRejected ? safe : new PublicReplyError("uncertain", safe.code, safe.retryAfterSeconds);
      }
    },
  };
}
