import { watchPhotoAsset, type PublicPhotoAsset } from "@hub/contract/watch-media";
import type { PublicReplyProposalRow } from "@hub/db";
import { textHash } from "../authorization";

/** Legacy plain text keeps its exact textHash. A photo binds caption and every reviewed asset descriptor field. */
export function reviewedPublicPayloadHash(text: string, photo: PublicPhotoAsset | null = null): string {
  const caption = textHash(text);
  if (!photo) return caption;
  const p = watchPhotoAsset.parse(photo);
  return textHash(JSON.stringify(["public-photo-v1", caption, p.kind, p.blobRef, p.sha256, p.mime, p.bytes, p.width, p.height]));
}
export const publicReplyPayloadHash = (p: Pick<PublicReplyProposalRow, "payloadHash" | "textHash">): string => p.payloadHash ?? p.textHash;
export const publicReplyTargetKey = (account: string, chatId: number, messageId: number): string =>
  textHash(JSON.stringify(["telegram_user", account, chatId, messageId]));

export function publicPayloadValid(p: PublicReplyProposalRow): boolean {
  try {
    return p.textHash === textHash(p.text) && publicReplyPayloadHash(p) === reviewedPublicPayloadHash(p.text, p.photo) &&
      p.targetKey === publicReplyTargetKey(p.account, p.chatId, p.replyToMessageId);
  } catch { return false; }
}
