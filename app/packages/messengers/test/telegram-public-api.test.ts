import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintAuthorization, textHash } from "../src/authorization";
import { mtcuteSessionClient } from "../src/telegram-user-api";
import { reviewedPublicPayloadHash } from "../src/public-replies/payload";
import type { PreparedPublicPhoto } from "../src/public-reply";
import { PHOTO, PHOTO_BYTES } from "./public-replies/photo-fixture";

const sdk = vi.hoisted(() => ({
  history: vi.fn(),
  resolve: vi.fn(),
  join: vi.fn(),
  send: vi.fn(),
  markRead: vi.fn(),
  fullChat: vi.fn(),
  member: vi.fn(),
  messages: vi.fn(),
  upload: vi.fn(),
  rpc: vi.fn(),
  resolvePeer: vi.fn(),
  sendMedia: vi.fn(),
}));

// Exercise the real public adapter at its SDK boundary, without a connection, session or Telegram request.
vi.mock("@mtcute/node", () => ({
  TelegramClient: class {
    getHistory = sdk.history;
    getChat = sdk.resolve;
    getFullChat = sdk.fullChat;
    getChatMember = sdk.member;
    getMessages = sdk.messages;
    joinChat = sdk.join;
    sendText = sdk.send;
    sendMedia = sdk.sendMedia;
    uploadFile = sdk.upload;
    call = sdk.rpc;
    resolvePeer = sdk.resolvePeer;
    readHistory = sdk.markRead;
  },
}));

interface Reply {
  origin: "same_chat" | "other_chat" | "private";
  id: number | null;
  threadId: number | null;
}
interface HistoryParams {
  limit: number;
  minId?: number;
  offset?: { id: number; date: number };
  reverse?: boolean;
}
const at = new Date("2026-11-27T07:00:00.000Z");
const message = (id: number, reply: Reply | null = null) => ({
  id, date: at, text: `message ${id}`,
  sender: { type: "user", id: 7, username: "reader" },
  replyToMessage: reply,
});
const peer = { id: -1001234567890, accessHash: null };
const publicApi = () => {
  const client = mtcuteSessionClient({ apiId: 1, apiHash: "fixture", session: "fixture" });
  if (!client.public) throw new Error("public reader missing");
  return client.public;
};

// Match the provider's documented ordering and offset contract, including its silent empty reverse read.
const serve = (ids: number[]) => sdk.history.mockImplementation(async (_peer: unknown, p: HistoryParams) => {
  const rows = ids.filter((id) => id > (p.minId ?? 0));
  if (p.reverse) return p.offset ? rows.filter((id) => id >= (p.offset?.id ?? 0)).sort((a, b) => a - b).slice(0, p.limit).map((id) => message(id)) : [];
  return rows.sort((a, b) => b - a).slice(0, p.limit).map((id) => message(id));
});

beforeEach(() => vi.clearAllMocks());

describe("public Telegram history: provider boundary", () => {
  it("bootstraps only the newest bounded page and returns it in ascending order", async () => {
    serve([10, 20, 30, 40, 50]);
    const rows = await publicApi().history(peer, { minId: 0, limit: 3 });
    expect(rows.map((m) => m.id)).toEqual([30, 40, 50]);
    expect(sdk.history).toHaveBeenCalledExactlyOnceWith(peer.id, { limit: 3 });
  });

  it("passes a reverse offset and drains a backlog larger than one page without gaps or duplicates", async () => {
    serve([80, 100, 101, 105, 106, 110, 150]);
    const reader = publicApi();
    const first = await reader.history(peer, { minId: 100, limit: 2 });
    const second = await reader.history(peer, { minId: 105, limit: 2 });
    const third = await reader.history(peer, { minId: 110, limit: 2 });
    expect([...first, ...second, ...third].map((m) => m.id)).toEqual([101, 105, 106, 110, 150]);
    expect(sdk.history).toHaveBeenNthCalledWith(1, peer.id, { minId: 100, limit: 2, reverse: true, offset: { id: 101, date: 0 } });
    expect(sdk.history).toHaveBeenNthCalledWith(2, peer.id, { minId: 105, limit: 2, reverse: true, offset: { id: 106, date: 0 } });
  });

  it("returns an empty read after the cursor catches up", async () => {
    serve([80, 100]);
    await expect(publicApi().history(peer, { minId: 100, limit: 100 })).resolves.toEqual([]);
  });

  it("retains local reply/topic ids and does not confuse an external quote with a local parent", async () => {
    sdk.history.mockResolvedValueOnce([
      message(3, { origin: "other_chat", id: 8, threadId: 2 }),
      message(2, { origin: "same_chat", id: 1, threadId: 1 }),
      message(1),
    ]);
    const rows = await publicApi().history(peer, { minId: 0, limit: 100 });
    expect(rows.map((m) => [m.id, m.replyToMessageId, m.threadId])).toEqual([[1, null, null], [2, 1, 1], [3, null, 2]]);
    expect(rows[1]).toMatchObject({ senderId: 7, senderUsername: "reader", text: "message 2", date: at });
  });

  it("keeps the stored access hash on a resumed read", async () => {
    serve([2]);
    await publicApi().history({ ...peer, accessHash: "1234" }, { minId: 1, limit: 100 });
    expect(sdk.history.mock.calls[0]?.[0]).toMatchObject({ _: "inputPeerChannel", channelId: 1234567890 });
  });

  it("propagates a flood wait once without sending, joining or marking read", async () => {
    const failure = Object.assign(new Error("FLOOD_WAIT_20"), { seconds: 20 });
    sdk.history.mockRejectedValueOnce(failure);
    await expect(publicApi().history(peer, { minId: 100, limit: 100 })).rejects.toBe(failure);
    expect(sdk.history).toHaveBeenCalledTimes(1);
    for (const call of [sdk.resolve, sdk.join, sdk.send, sdk.markRead]) expect(call).not.toHaveBeenCalled();
  });
});

const publicSender = () => {
  const sender = mtcuteSessionClient({ apiId: 1, apiHash: "fixture", session: "fixture" }).publicSender;
  if (!sender) throw new Error("public sender missing");
  return sender;
};
const chat = () => ({ id: peer.id, title: "Acme", inputPeer: { _: "inputPeerChat" }, chatType: "supergroup", isMember: true,
  isMin: false, username: "Acme_Chat", hasJoinRequests: false, permissions: null, defaultPermissions: null, pinnedMsgId: 5,
  bio: "Technical discussion", slowmodeNextSendDate: null });
const publicMessage = (id: number, outgoing = false, replyTo = 42) => ({ ...message(id), chat: { id: peer.id }, isOutgoing: outgoing, isService: false,
  replyToMessage: { origin: "same_chat", id: replyTo, threadId: 20 } });
const authorizedPublic = () => mintAuthorization({ targetKind: "public_reply",
  authority: { kind: "watch_review", actor: "watch_review", requestRef: "owner-request", policyGeneration: "generation", policyRevision: 1, reviewRef: "review" },
  project: "acme", proposalId: "p", account: "123456", chatId: peer.id, accessHash: null, replyToMessageId: 42, threadId: 20,
  text: "A reviewed reply", textHash: textHash("A reviewed reply"), randomId: "123456789012345", policyGeneration: "generation" });

describe("public membership and guarded reply provider boundary", () => {
  it("returns canonical membership metadata and refreshes an already resolved peer without a username resolve", async () => {
    sdk.resolve.mockResolvedValue(chat());
    const reader = publicApi();
    expect(await reader.resolve("acme_chat")).toMatchObject({ kind: "group", isMember: true, canonicalUsername: "acme_chat", hasJoinRequests: false });
    expect(await reader.inspect?.(peer)).toMatchObject({ isMember: true });
    expect(sdk.resolve).toHaveBeenLastCalledWith(peer.id);
    expect(sdk.join).not.toHaveBeenCalled();
  });

  it("distinguishes membership requests and guard webviews, and joining an existing membership is idempotent", async () => {
    sdk.join.mockResolvedValueOnce({ status: "request_sent" }).mockResolvedValueOnce({ status: "webview" })
      .mockRejectedValueOnce(Object.assign(new Error("already joined"), { text: "USER_ALREADY_PARTICIPANT" }));
    const reader = publicApi();
    expect(await reader.join(peer)).toBe("pending");
    expect(await reader.join(peer)).toBe("manual_required");
    expect(await reader.join(peer)).toBe("joined");
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it("checks only the signed-in member and the latest pin; restricted or broadcast targets cannot write", async () => {
    sdk.fullChat.mockResolvedValue(chat());
    sdk.member.mockResolvedValue({ status: "member", restrictions: null, isMember: true });
    sdk.messages.mockResolvedValue([publicMessage(42), publicMessage(5)]);
    const sender = publicSender();
    expect(await sender.inspect(peer, 42)).toMatchObject({ canSendText: true, source: { id: 42, threadId: 20 }, rules: { latestPinOnly: true, pinned: { id: 5 } } });
    expect(sdk.member).toHaveBeenLastCalledWith({ chatId: peer.id, userId: "self" });
    sdk.member.mockResolvedValue({ status: "restricted", restrictions: { canSendMessages: false, canSendText: true }, isMember: true });
    expect(await sender.inspect(peer, 42)).toMatchObject({ canSendText: false, refusal: "TEXT_NOT_PERMITTED" });
    sdk.fullChat.mockResolvedValue({ ...chat(), chatType: "channel" });
    expect(await sender.inspect(peer, 42)).toMatchObject({ canSendText: false, refusal: "BROADCAST_OR_UNSUPPORTED_CHAT" });
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it("sends only a minted exact reply with persistent random id and reads the saved provider receipt", async () => {
    const auth = authorizedPublic();
    sdk.send.mockResolvedValue({ id: 500 });
    sdk.messages.mockResolvedValue([{ ...publicMessage(500, true), text: auth.text }]);
    const got = await publicSender().send(auth);
    expect(got).toMatchObject({ messageId: 500, chatId: peer.id, replyToMessageId: 42, threadId: 20, outgoing: true, text: auth.text });
    const params: unknown = sdk.send.mock.calls[0]?.[2];
    expect(params).toMatchObject({ replyTo: 42, threadId: 20, mustReply: true, disableWebPreview: true });
    expect(typeof params === "object" && params !== null ? String(Reflect.get(params, "randomId")) : "").toBe(auth.randomId);
    expect(params).not.toHaveProperty("commentTo");
    expect(params).not.toHaveProperty("allowPaidMessages");
    expect(sdk.messages).toHaveBeenLastCalledWith(peer.id, 500);
  });

  it("a generic 4xx/FloodWait raised inside the SDK cannot prove its send RPC never completed", async () => {
    sdk.send.mockRejectedValueOnce(Object.assign(new Error("metadata flood"), { code: 420, text: "FLOOD_WAIT_90", seconds: 90 }));
    await expect(publicSender().send(authorizedPublic())).rejects.toMatchObject({ outcome: "uncertain", code: "FLOOD_WAIT_90", retryAfterSeconds: 90 });
    expect(sdk.send).toHaveBeenCalledTimes(1);
  });

  it("a forged authorization never reaches Telegram; a receipt failure after send remains uncertain even on 4xx", async () => {
    const sender = publicSender();
    await expect(Reflect.apply(sender.send, sender, [{}])).rejects.toMatchObject({ code: "not_authorized" });
    expect(sdk.send).not.toHaveBeenCalled();
    sdk.send.mockResolvedValue({ id: 500 });
    sdk.messages.mockRejectedValueOnce(Object.assign(new Error("read refused"), { code: 403, text: "CHANNEL_PRIVATE" }));
    await expect(sender.send(authorizedPublic())).rejects.toMatchObject({ outcome: "uncertain", messageId: 500, code: "CHANNEL_PRIVATE" });
    expect(sdk.send).toHaveBeenCalledTimes(1);
  });
});

const photoIdentity = (): PreparedPublicPhoto => ({ account: "123456", assetHash: PHOTO.sha256, photoId: "9001", accessHash: "1234", fileReference: "AQID" });
const authorizedPhoto = (preparedPhoto: PreparedPublicPhoto | null = null) => mintAuthorization({
  ...authorizedPublic(), photo: PHOTO, payloadHash: reviewedPublicPayloadHash("A reviewed reply", PHOTO), preparedPhoto,
});
const savedPhoto = (id = 500) => ({ ...publicMessage(id, true), text: "A reviewed reply", media: { type: "photo", id: 9001n } });
const prepare = async (bytes = PHOTO_BYTES) => {
  const sender = publicSender();
  if (!sender.preparePhoto) throw new Error("photo preparation missing");
  return sender.preparePhoto(authorizedPhoto(), bytes);
};

describe("exact public photo provider boundary", () => {
  beforeEach(() => {
    for (const mock of [sdk.upload, sdk.rpc, sdk.resolvePeer, sdk.sendMedia, sdk.messages, sdk.fullChat, sdk.member]) mock.mockReset();
    sdk.resolvePeer.mockResolvedValue({ _: "inputPeerChannel", channelId: 1234567890, accessHash: 1234n });
    sdk.upload.mockResolvedValue({ inputFile: { _: "inputFile", id: 10n, parts: 1, name: PHOTO.blobRef, md5Checksum: "" } });
    sdk.rpc.mockResolvedValue({ _: "messageMediaPhoto", photo: { _: "photo", id: 9001n, accessHash: 1234n, fileReference: Buffer.from([1, 2, 3]) } });
    sdk.sendMedia.mockResolvedValue({ id: 500 });
    sdk.messages.mockResolvedValue([savedPhoto()]);
  });

  it("prepares the exact bytes with bounded uploadMedia, without sending a chat message", async () => {
    expect(await prepare()).toEqual(photoIdentity());
    expect(sdk.upload).toHaveBeenCalledExactlyOnceWith({ file: PHOTO_BYTES, fileName: PHOTO.blobRef, fileMime: PHOTO.mime, abortSignal: expect.any(AbortSignal) });
    expect(sdk.rpc).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      _: "messages.uploadMedia", peer: expect.objectContaining({ _: "inputPeerChannel" }),
      media: expect.objectContaining({ _: "inputMediaUploadedPhoto", file: expect.objectContaining({ name: PHOTO.blobRef }) }),
    }), { abortSignal: expect.any(AbortSignal), timeout: 20_000, maxRetryCount: 0, floodSleepThreshold: 0 });
    expect(sdk.resolvePeer).toHaveBeenCalledExactlyOnceWith(peer.id);
    expect(sdk.send).not.toHaveBeenCalled();
    expect(sdk.sendMedia).not.toHaveBeenCalled();
  });

  it("rejects changed bytes before upload and treats an unknown upload as non-public, without a retry", async () => {
    await expect(prepare(PHOTO_BYTES.subarray(0, 10))).rejects.toMatchObject({ outcome: "refused", code: "PHOTO_CHANGED" });
    expect(sdk.upload).not.toHaveBeenCalled();
    sdk.rpc.mockRejectedValueOnce(new Error("connection lost"));
    await expect(prepare()).rejects.toMatchObject({ outcome: "refused", code: "PHOTO_UPLOAD_UNKNOWN" });
    expect(sdk.upload).toHaveBeenCalledTimes(1);
    expect(sdk.rpc).toHaveBeenCalledTimes(1);
    expect(sdk.sendMedia).not.toHaveBeenCalled();
  });

  it("honours individual and parent photo restrictions from both self and group defaults", async () => {
    sdk.fullChat.mockResolvedValue({ ...chat(), pinnedMsgId: null });
    sdk.messages.mockResolvedValue([publicMessage(42)]);
    const allowed = { canSendMessages: true, canSendText: true, canSendMedia: true, canSendPhotos: true };
    const sender = publicSender();
    sdk.member.mockResolvedValue({ status: "member", restrictions: allowed, isMember: true });
    expect(await sender.inspect(peer, 42)).toMatchObject({ canSendText: true, canSendPhotos: true });
    for (const restrictions of [{ ...allowed, canSendMedia: false }, { ...allowed, canSendMessages: false }, { ...allowed, canSendPhotos: false }]) {
      sdk.member.mockResolvedValue({ status: "restricted", restrictions, isMember: true });
      expect(await sender.inspect(peer, 42)).toMatchObject({ canSendPhotos: false });
    }
    sdk.member.mockResolvedValue({ status: "member", restrictions: null, isMember: true });
    sdk.fullChat.mockResolvedValue({ ...chat(), pinnedMsgId: null, defaultPermissions: { ...allowed, canSendMedia: false } });
    expect(await sender.inspect(peer, 42)).toMatchObject({ canSendText: true, canSendPhotos: false });
    sdk.member.mockResolvedValue({ status: "admin", restrictions: null, isMember: true });
    expect(await sender.inspect(peer, 42)).toMatchObject({ canSendPhotos: true });
    expect(sdk.sendMedia).not.toHaveBeenCalled();
  });

  it("sends only the prepared photo reference, exact caption and persistent reply/topic/random id", async () => {
    const auth = authorizedPhoto(photoIdentity());
    expect(await publicSender().send(auth)).toMatchObject({ messageId: 500, mediaType: "photo", photoId: "9001", text: auth.text, replyToMessageId: 42, threadId: 20 });
    const call = sdk.sendMedia.mock.calls[0];
    expect(call?.[0]).toBe(peer.id);
    const media: unknown = call?.[1];
    expect(media).toMatchObject({ _: "inputMediaPhoto", id: { _: "inputPhoto", fileReference: Buffer.from([1, 2, 3]) } });
    if (typeof media !== "object" || media === null) throw new Error("media was not prepared");
    const id: unknown = Reflect.get(media, "id");
    if (typeof id !== "object" || id === null) throw new Error("photo identity missing");
    expect(String(Reflect.get(id, "id"))).toBe("9001");
    const params: unknown = call?.[2];
    expect(params).toMatchObject({ caption: auth.text, replyTo: 42, threadId: 20, mustReply: true, abortSignal: expect.any(AbortSignal) });
    expect(typeof params === "object" && params !== null ? String(Reflect.get(params, "randomId")) : "").toBe(auth.randomId);
    expect(params).not.toHaveProperty("commentTo");
    expect(sdk.upload).not.toHaveBeenCalled();
    expect(sdk.rpc).not.toHaveBeenCalled();
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it("a missing or expired prepared reference cannot trigger a fresh upload or a fallback text post", async () => {
    await expect(publicSender().send(authorizedPhoto())).rejects.toMatchObject({ outcome: "refused", code: "PHOTO_NOT_PREPARED" });
    expect(sdk.sendMedia).not.toHaveBeenCalled();
    sdk.sendMedia.mockRejectedValueOnce(Object.assign(new Error("expired"), { code: 400, text: "FILE_REFERENCE_EXPIRED" }));
    await expect(publicSender().send(authorizedPhoto(photoIdentity()))).rejects.toMatchObject({ outcome: "refused", code: "FILE_REFERENCE_EXPIRED" });
    expect(sdk.sendMedia).toHaveBeenCalledTimes(1);
    expect(sdk.upload).not.toHaveBeenCalled();
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it("never adopts a returned different message id and keeps a known-id receipt error unresolved", async () => {
    sdk.messages.mockResolvedValue([savedPhoto(501)]);
    const sender = publicSender();
    expect(await sender.receipt(peer, 500)).toBeNull();
    await expect(sender.send(authorizedPhoto(photoIdentity()))).rejects.toMatchObject({ outcome: "uncertain", code: "RECEIPT_NOT_READABLE", messageId: 500 });
    sdk.messages.mockRejectedValueOnce(Object.assign(new Error("read refused"), { code: 403, text: "CHANNEL_PRIVATE" }));
    await expect(sender.send(authorizedPhoto(photoIdentity()))).rejects.toMatchObject({ outcome: "uncertain", code: "CHANNEL_PRIVATE", messageId: 500 });
    expect(sdk.upload).not.toHaveBeenCalled();
  });

  it("an ambiguous media send is held, never retried by this adapter", async () => {
    sdk.sendMedia.mockRejectedValueOnce(Object.assign(new Error("metadata flood"), { code: 420, text: "FLOOD_WAIT_90", seconds: 90 }));
    await expect(publicSender().send(authorizedPhoto(photoIdentity()))).rejects.toMatchObject({ outcome: "uncertain", code: "FLOOD_WAIT_90", retryAfterSeconds: 90 });
    expect(sdk.sendMedia).toHaveBeenCalledTimes(1);
    expect(sdk.upload).not.toHaveBeenCalled();
  });
});
