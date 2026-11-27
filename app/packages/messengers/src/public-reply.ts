import type { PublicReplyAuthorization } from "./authorization";
import type { MtPublicTarget } from "./telegram-user";

/** Only normalized public source/rules and the signed-in account's own permissions; no member list. */
export interface PublicReplySnapshot {
  chatId: number;
  username: string | null;
  kind: "group" | "channel";
  isMember: boolean;
  canSendText: boolean;
  refusal: string | null;
  slowmodeUntil: string | null;
  source: { id: number; at: string; text: string; replyToMessageId: number | null; threadId: number | null; outgoing: boolean; service: boolean } | null;
  rules: { description: string; pinned: { id: number; text: string } | null; latestPinOnly: true };
}

export interface PublicReplyReceipt {
  messageId: number;
  chatId: number;
  replyToMessageId: number | null;
  threadId: number | null;
  text: string;
  outgoing: boolean;
  at: string;
}

/** A separate capability from MtPublic's reads/join; composition hands it only to the send door. */
export interface PublicReplySender {
  inspect(target: MtPublicTarget, messageId: number): Promise<PublicReplySnapshot>;
  send(authorization: PublicReplyAuthorization): Promise<PublicReplyReceipt>;
  receipt(target: MtPublicTarget, messageId: number): Promise<PublicReplyReceipt | null>;
}

/** No raw error text is logged. Unknown transport/server outcomes after a send must hold the target. */
export class PublicReplyError extends Error {
  constructor(readonly outcome: "refused" | "uncertain", readonly code: string, readonly retryAfterSeconds: number | null = null, readonly messageId: number | null = null) {
    super(code);
    this.name = "PublicReplyError";
  }
}

export function publicReplyError(error: unknown): PublicReplyError {
  if (error instanceof PublicReplyError) return error;
  if (typeof error === "object" && error !== null) {
    const code: unknown = Reflect.get(error, "code");
    const text: unknown = Reflect.get(error, "text");
    const seconds: unknown = Reflect.get(error, "seconds");
    if (typeof code === "number" && typeof text === "string") {
      const word = text.replace(/[^A-Z0-9_%]/g, "").slice(0, 80);
      const wait = typeof seconds === "number" ? seconds : Number(/(?:FLOOD_WAIT|SLOWMODE_WAIT)_(\d+)/.exec(text)?.[1] ?? 0);
      // Telegram's explicit 4xx rejection is definitive; 5xx/transport may follow a completed send.
      return new PublicReplyError(code >= 400 && code < 500 ? "refused" : "uncertain", word || "TELEGRAM_ERROR", wait > 0 ? wait : null);
    }
    if (error instanceof Error && error.name === "MtMessageNotFoundError") return new PublicReplyError("refused", "REPLY_MESSAGE_MISSING");
  }
  return new PublicReplyError("uncertain", "DELIVERY_UNKNOWN");
}
