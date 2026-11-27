import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type PublicReplyProposalRow } from "@hub/db";
import { applyPublicReply, assessPublicReply, proposePublicReply, publicReplyHashes, publicReplyPayloadHash, reconcilePublicReply, type PublicReplyDoorDeps, type PublicReplyPolicy } from "../../src/public-door";
import { assertPublicAuthorized, type PublicReplyAuthorization } from "../../src/authorization";
import { PublicReplyError, type PreparedPublicPhoto, type PublicReplyReceipt, type PublicReplySnapshot } from "../../src/public-reply";
import type { PublicPhotoAsset } from "@hub/contract/watch-media";
import { PHOTO, PHOTO_BYTES } from "./photo-fixture";

const START = Date.parse("2026-11-27T10:00:00.000Z");
const ACCOUNT = "123456";
const CHAT = -1001234567890;
let handle: DbHandle;
let deps: PublicReplyDoorDeps;
let clock: number;
let snapshot: PublicReplySnapshot;
let policy: PublicReplyPolicy;
let review: number;
const inspect = vi.fn<() => Promise<PublicReplySnapshot>>();
const prepare = vi.fn<(a: PublicReplyAuthorization, bytes: Uint8Array) => Promise<PreparedPublicPhoto>>();
const send = vi.fn<(a: PublicReplyAuthorization) => Promise<PublicReplyReceipt>>();
const receipt = vi.fn<() => Promise<PublicReplyReceipt | null>>();
const read = vi.fn<(project: string, photo: PublicPhotoAsset) => Promise<{ bytes: Uint8Array; mime: PublicPhotoAsset["mime"] }>>();
const prepared = (): PreparedPublicPhoto => ({ account: ACCOUNT, assetHash: PHOTO.sha256, photoId: "9001", accessHash: "1234", fileReference: "AQID" });
const proof = (p: PublicReplyProposalRow): PublicReplyReceipt => ({ messageId: 500, chatId: p.chatId, replyToMessageId: p.replyToMessageId,
  threadId: p.threadId, text: p.text, outgoing: true, at: new Date(clock).toISOString(), mediaType: p.photo ? "photo" : null, photoId: p.photo ? "9001" : null });
async function propose(photo: PublicPhotoAsset | null = PHOTO, direction = "support"): Promise<PublicReplyProposalRow> {
  const r = await proposePublicReply(deps, { project: "acme", direction, groupUsername: "acme_chat", account: ACCOUNT,
    target: { id: CHAT, accessHash: "1234" }, messageId: 42, text: "The diagram shows the command and its expected result.",
    ...(photo ? { photo } : {}), ...publicReplyHashes(snapshot), reviewRef: `review:${++review}`, reviewedAt: new Date(clock).toISOString() });
  if ("refused" in r) throw new Error(r.refused.join("; "));
  return r.proposal;
}
beforeEach(() => {
  handle = openDb(":memory:");
  clock = START; review = 0;
  snapshot = { chatId: CHAT, username: "acme_chat", kind: "group", isMember: true, canSendText: true, canSendPhotos: true,
    refusal: null, slowmodeUntil: null, source: { id: 42, at: new Date(START - 120_000).toISOString(), text: "How do I inspect this build?",
      replyToMessageId: 30, threadId: 20, outgoing: false, service: false }, rules: { description: "Technical help is welcome.", pinned: null, latestPinOnly: true } };
  policy = { refusal: null, generation: "photo-grant", revision: 2, requestRef: "owner-review", strategyHash: "a".repeat(64), repliesPerDay: 3, photoReplies: true };
  vi.resetAllMocks();
  deps = { repos: createRepos(handle.db), now: () => new Date(clock), policy: () => policy,
    sender: () => ({ inspect, preparePhoto: prepare, send, receipt }), assets: { read } };
  inspect.mockImplementation(async () => structuredClone(snapshot));
  read.mockResolvedValue({ bytes: PHOTO_BYTES, mime: "image/png" });
  prepare.mockImplementation(async (a, bytes) => {
    assertPublicAuthorized(a);
    expect(Buffer.from(bytes)).toEqual(PHOTO_BYTES);
    expect(await deps.repos.sends.publicAttempt(a.proposalId)).toBeNull();
    expect(a.preparedPhoto).toBeNull();
    return prepared();
  });
  send.mockImplementation(async (a) => {
    assertPublicAuthorized(a);
    expect(await deps.repos.sends.publicAttempt(a.proposalId)).toMatchObject({ status: "sending", messengerDraftId: null });
    if (a.photo) {
      expect(await deps.repos.sends.publicPhoto("acme", a.proposalId)).toMatchObject(prepared());
      expect(a.preparedPhoto).toEqual(prepared());
      expect(Object.isFrozen(a.photo)).toBe(true);
      expect(Object.isFrozen(a.preparedPhoto)).toBe(true);
    }
    return { messageId: 500, chatId: a.chatId, replyToMessageId: a.replyToMessageId, threadId: a.threadId, text: a.text, outgoing: true,
      at: new Date(clock).toISOString(), mediaType: a.photo ? "photo" : null, photoId: a.photo ? "9001" : null };
  });
  receipt.mockResolvedValue(null);
});
afterEach(() => handle.close());

describe("one exact reviewed public photo through the shared door", () => {
  it("propose and both assessment modes never upload; a caption hash cannot confirm the photo", async () => {
    const p = await propose();
    expect(publicReplyPayloadHash(p)).not.toBe(p.textHash);
    const before = inspect.mock.calls.length;
    expect(await assessPublicReply(deps, "acme", p.id, { fresh: false })).toMatchObject({ state: "ready", reasons: [] });
    expect(inspect).toHaveBeenCalledTimes(before);
    expect(await assessPublicReply(deps, "acme", p.id, { fresh: true })).toMatchObject({ state: "ready" });
    expect(prepare).not.toHaveBeenCalled();
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toHaveProperty("refused");
    expect(send).not.toHaveBeenCalled();
    expect(await deps.repos.sends.publicAttempt(p.id)).toBeNull();
  });

  it("prepares once, persists the exact provider identity before the audit and delivers only that photo", async () => {
    const p = await propose();
    expect(await applyPublicReply(deps, "acme", p.id, publicReplyPayloadHash(p))).toMatchObject({ status: "sent", messageId: "500" });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await applyPublicReply(deps, "acme", p.id, publicReplyPayloadHash(p))).toMatchObject({ status: "sent" });
    expect(prepare).toHaveBeenCalledTimes(1);
    const auth = send.mock.calls[0]?.[0];
    expect(auth).toMatchObject({ photo: PHOTO, preparedPhoto: prepared(), payloadHash: publicReplyPayloadHash(p), randomId: p.randomId, replyToMessageId: 42, threadId: 20 });
  });

  it("keeps legacy text viable and refuses media without its explicit grant, bytes or photo rights", async () => {
    policy = { ...policy };
    delete policy.photoReplies;
    await expect(propose()).rejects.toThrow(/does not allow photo/);
    const plain = await propose(null);
    expect(publicReplyPayloadHash(plain)).toBe(plain.textHash);
    expect(await applyPublicReply(deps, "acme", plain.id, plain.textHash)).toMatchObject({ status: "sent" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each(["expiry", "source", "rights", "policy", "stop"])("refuses a %s change that occurred during upload before any send audit", async (change) => {
    const p = await propose();
    prepare.mockImplementationOnce(async () => {
      if (change === "expiry") clock += 31 * 60_000;
      if (change === "source" && snapshot.source) snapshot.source.text = "Edited while the photo was uploading.";
      if (change === "rights") snapshot.canSendPhotos = false;
      if (change === "policy") policy = { ...policy, generation: "revoked", refusal: "owner revoked the grant" };
      if (change === "stop") await deps.repos.sends.stop();
      return prepared();
    });
    expect(await applyPublicReply(deps, "acme", p.id, publicReplyPayloadHash(p))).toHaveProperty("refused");
    expect(await deps.repos.sends.publicPhoto("acme", p.id)).toMatchObject(prepared());
    expect(await deps.repos.sends.publicAttempt(p.id)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses missing/changed bytes before upload and denies a source with text but no photo permission", async () => {
    const p = await propose();
    read.mockRejectedValueOnce(new Error("asset replaced"));
    expect(await applyPublicReply(deps, "acme", p.id, publicReplyPayloadHash(p))).toHaveProperty("refused");
    expect(prepare).not.toHaveBeenCalled();
    snapshot.canSendPhotos = false;
    expect(await applyPublicReply(deps, "acme", p.id, publicReplyPayloadHash(p))).toMatchObject({ refused: [expect.stringMatching(/photos are not permitted/)] });
    expect(send).not.toHaveBeenCalled();
  });

  it("holds an unknown delivery across reload and reconciles only the exact requested message and prepared photo", async () => {
    const p = await propose();
    send.mockRejectedValueOnce(new Error("connection lost after messages.sendMedia"));
    expect(await applyPublicReply(deps, "acme", p.id, publicReplyPayloadHash(p))).toMatchObject({ status: "uncertain" });
    deps = { ...deps, repos: createRepos(handle.db) };
    clock += 3_600_000; policy = { ...policy, refusal: "revoked" };
    expect(await applyPublicReply(deps, "acme", p.id, publicReplyPayloadHash(p))).toMatchObject({ status: "uncertain" });
    receipt.mockResolvedValueOnce({ ...proof(p), photoId: "another-photo" });
    expect(await reconcilePublicReply(deps, "acme", p.id, 500)).toHaveProperty("refused");
    receipt.mockResolvedValueOnce({ ...proof(p), messageId: 501 });
    expect(await reconcilePublicReply(deps, "acme", p.id, 500)).toHaveProperty("refused");
    receipt.mockResolvedValueOnce(proof(p));
    expect(await reconcilePublicReply(deps, "acme", p.id, 500)).toMatchObject({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("anchors reconciliation to a known provider id and never marks a failed receipt read as sent", async () => {
    const p = await propose();
    send.mockRejectedValueOnce(new PublicReplyError("uncertain", "RECEIPT_NOT_READABLE", null, 500));
    expect(await applyPublicReply(deps, "acme", p.id, publicReplyPayloadHash(p))).toMatchObject({ status: "uncertain", messageId: "500" });
    expect(await reconcilePublicReply(deps, "acme", p.id, 501)).toMatchObject({ refused: [expect.stringMatching(/differs from the provider id/)] });
    expect(receipt).not.toHaveBeenCalled();
    receipt.mockRejectedValueOnce(new Error("receipt read failed"));
    expect(await reconcilePublicReply(deps, "acme", p.id)).toHaveProperty("refused");
    expect(await deps.repos.sends.publicAttempt(p.id)).toMatchObject({ status: "sending", sentMessageId: "500" });
    receipt.mockResolvedValueOnce({ ...proof(p), at: "not-a-date" });
    expect(await reconcilePublicReply(deps, "acme", p.id)).toHaveProperty("refused");
    receipt.mockResolvedValueOnce(proof(p));
    expect(await reconcilePublicReply(deps, "acme", p.id)).toMatchObject({ status: "sent", messageId: "500" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not accept a matching caption and different photo, or duplicate the target from a new direction", async () => {
    const p = await propose();
    send.mockResolvedValueOnce({ ...proof(p), photoId: "9002" });
    expect(await applyPublicReply(deps, "acme", p.id, publicReplyPayloadHash(p))).toMatchObject({ status: "uncertain", reason: "RECEIPT_MISMATCH" });
    clock += 30_000;
    const next = await propose(null, "another");
    expect(next.targetKey).toBe(p.targetKey);
    expect(await assessPublicReply(deps, "acme", next.id, { fresh: false })).toMatchObject({ state: "held", reasons: [expect.stringMatching(/live reply attempt/)] });
    expect(await applyPublicReply(deps, "acme", next.id, next.textHash)).toHaveProperty("refused");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
