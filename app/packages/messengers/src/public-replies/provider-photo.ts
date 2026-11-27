import { createHash } from "node:crypto";
import { Long, type tl } from "@mtcute/core";
import type { TelegramClient } from "@mtcute/node";
import { WATCH_PHOTO_LIMITS } from "@hub/contract/watch-media";
import { assertPublicAuthorized, type PublicReplyAuthorization } from "../authorization";
import { PublicReplyError, publicReplyError, type PreparedPublicPhoto } from "../public-reply";
import type { MtPublicTarget } from "../telegram-user";
import { reviewedPublicPayloadHash } from "./payload";

const refuse = (code: string): never => { throw new PublicReplyError("refused", code); };

/** Public supported SDK calls; uploadMedia's 0.32.8 high-level wrapper has no abort option, so use the bounded raw RPC. */
export async function prepareTelegramPhoto(tg: TelegramClient, inputOf: (t: MtPublicTarget) => tl.TypeInputPeer | number,
  authorization: PublicReplyAuthorization, bytes: Uint8Array): Promise<PreparedPublicPhoto> {
  assertPublicAuthorized(authorization);
  const photo = authorization.photo;
  if (!photo || authorization.preparedPhoto || authorization.payloadHash !== reviewedPublicPayloadHash(authorization.text, photo)) return refuse("PHOTO_NOT_AUTHORIZED");
  const file = Buffer.from(bytes);
  if (!file.length || file.length > WATCH_PHOTO_LIMITS.bytes || file.length !== photo.bytes ||
    createHash("sha256").update(file).digest("hex") !== photo.sha256) return refuse("PHOTO_CHANGED");
  try {
    const abortSignal = AbortSignal.timeout(20_000);
    const input = inputOf({ id: authorization.chatId, accessHash: authorization.accessHash });
    const peer = typeof input === "number" ? await tg.resolvePeer(input) : input;
    abortSignal.throwIfAborted();
    const uploaded = await tg.uploadFile({ file, fileName: photo.blobRef, fileMime: photo.mime, abortSignal });
    const media = await tg.call({ _: "messages.uploadMedia", peer, media: { _: "inputMediaUploadedPhoto", file: uploaded.inputFile } },
      { abortSignal, timeout: 20_000, maxRetryCount: 0, floodSleepThreshold: 0 });
    if (media._ !== "messageMediaPhoto" || media.photo?._ !== "photo") return refuse("PHOTO_PREPARATION_INVALID");
    return { account: authorization.account, assetHash: photo.sha256, photoId: media.photo.id.toString(),
      accessHash: media.photo.accessHash.toString(), fileReference: Buffer.from(media.photo.fileReference).toString("base64") };
  } catch (error) {
    const safe = publicReplyError(error);
    // Even an unknown upload outcome cannot have posted a chat message. No send audit exists yet.
    throw new PublicReplyError("refused", safe.code === "DELIVERY_UNKNOWN" ? "PHOTO_UPLOAD_UNKNOWN" : safe.code, safe.retryAfterSeconds);
  }
}

/** Only a durably prepared exact photo reference may reach sendMedia; the client never reuploads on a send retry. */
export function preparedTelegramPhoto(authorization: PublicReplyAuthorization): tl.TypeInputMedia {
  const photo = authorization.photo;
  const prepared = authorization.preparedPhoto;
  if (!photo || !prepared || prepared.account !== authorization.account || prepared.assetHash !== photo.sha256 ||
    !/^[1-9][0-9]*$/.test(prepared.photoId) || !/^-?[0-9]+$/.test(prepared.accessHash) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(prepared.fileReference)) return refuse("PHOTO_NOT_PREPARED");
  const reference = Buffer.from(prepared.fileReference, "base64");
  if (!reference.length || reference.length > 4096 || reference.toString("base64") !== prepared.fileReference) return refuse("PHOTO_REFERENCE_INVALID");
  return { _: "inputMediaPhoto", id: { _: "inputPhoto", id: Long.fromString(prepared.photoId),
    accessHash: Long.fromString(prepared.accessHash), fileReference: reference } };
}
