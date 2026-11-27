import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type PublicReplyProposalRow } from "@hub/db";
import { applyMessenger } from "../src/door";
import { applyPublicReply, proposePublicReply, publicReplyHashes, reconcilePublicReply, type PublicReplyDoorDeps, type PublicReplyPolicy } from "../src/public-door";
import { assertPublicAuthorized, type PublicReplyAuthorization } from "../src/authorization";
import { PublicReplyError, type PublicReplySnapshot, type PublicReplyReceipt } from "../src/public-reply";

const START = Date.parse("2026-11-27T10:00:00.000Z");
const ACCOUNT = "123456";
const CHAT = -1001234567890;
const source = { id: 42, at: new Date(START - 120_000).toISOString(), text: "How can I inspect a stalled build?", replyToMessageId: 30, threadId: 20, outgoing: false, service: false };
const snapshotOf = (): PublicReplySnapshot => ({ chatId: CHAT, username: "acme_chat", kind: "group", isMember: true, canSendText: true,
  refusal: null, slowmodeUntil: null, source: { ...source }, rules: { description: "Technical discussion; no unsolicited ads.", pinned: { id: 5, text: "Reply in the existing thread." }, latestPinOnly: true } });
const policyOf = (): PublicReplyPolicy => ({ refusal: null, generation: "grant-and-send-policy", revision: 1, requestRef: "owner-request-1", strategyHash: "a".repeat(64), repliesPerDay: 3 });
let handle: DbHandle;
let deps: PublicReplyDoorDeps;
let clock: number;
let snapshot: PublicReplySnapshot;
let policy: PublicReplyPolicy;
let review = 0;
const inspect = vi.fn<() => Promise<PublicReplySnapshot>>();
const send = vi.fn<(a: PublicReplyAuthorization) => Promise<PublicReplyReceipt>>();
const receipt = vi.fn<() => Promise<PublicReplyReceipt | null>>();
const failed = vi.fn();

const proof = (p: PublicReplyProposalRow, id = 500): PublicReplyReceipt => ({ messageId: id, chatId: p.chatId, replyToMessageId: p.replyToMessageId,
  threadId: p.threadId, text: p.text, outgoing: true, at: new Date(clock).toISOString() });
async function propose(over: { direction?: string; text?: string; messageId?: number } = {}): Promise<PublicReplyProposalRow> {
  const r = await proposePublicReply(deps, { project: "acme", direction: over.direction ?? "support", groupUsername: "acme_chat", account: ACCOUNT,
    target: { id: CHAT, accessHash: "1234" }, messageId: over.messageId ?? 42, text: over.text ?? "Check the worker log for the first failed command.",
    ...publicReplyHashes(snapshot), reviewRef: `review:${++review}`, reviewedAt: new Date(clock).toISOString() });
  if ("refused" in r) throw new Error(r.refused.join("; "));
  return r.proposal;
}

beforeEach(() => {
  handle = openDb(":memory:");
  clock = START;
  review = 0;
  snapshot = snapshotOf();
  policy = policyOf();
  vi.resetAllMocks();
  deps = { repos: createRepos(handle.db), now: () => new Date(clock), policy: () => policy,
    sender: () => ({ inspect, send, receipt }), failed };
  inspect.mockImplementation(async () => structuredClone(snapshot));
  send.mockImplementation(async (a) => {
    assertPublicAuthorized(a);
    const audit = await deps.repos.sends.publicAttempt(a.proposalId);
    expect(audit).toMatchObject({ status: "sending", actor: "watch_review", messengerDraftId: null, ownerWord: null });
    return { messageId: 500, chatId: a.chatId, replyToMessageId: a.replyToMessageId, threadId: a.threadId, text: a.text, outgoing: true, at: new Date(clock).toISOString() };
  });
  receipt.mockResolvedValue(null);
});
afterEach(() => handle.close());

describe("reviewed public reply through the shared send door", () => {
  it("stores an unsent immutable proposal, audits before one exact reply and never creates a private chat or draft", async () => {
    const p = await propose();
    expect(await deps.repos.sends.list("acme")).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    const r = await applyPublicReply(deps, "acme", p.id, p.textHash);
    expect(r).toMatchObject({ status: "sent", messageId: "500" });
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ status: "sent", messageId: "500" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ targetKind: "public_reply", randomId: p.randomId, replyToMessageId: 42, threadId: 20 });
    expect(await deps.repos.messengers.knownChats("acme")).toEqual([]);
    expect(await deps.repos.messengers.listDrafts("acme", ["draft", "sent"])).toEqual([]);
  });

  it("refuses missing/revoked grants, changed confirmation, Stop, and use of public authority on a private draft", async () => {
    const p = await propose();
    policy = { ...policy, refusal: "owner grant revoked" };
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ refused: ["owner grant revoked"] });
    policy = policyOf();
    expect(await applyPublicReply(deps, "acme", p.id, "b".repeat(64))).toHaveProperty("refused");
    await deps.repos.sends.stop();
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ refused: ["Stop sending is on"] });
    const privateResult = await applyMessenger({ repos: deps.repos, policy: () => ({ lifecycle: null, generation: "g", recipients: () => null }) },
      "acme", 1, { chatId: "1", text: "x" }, { kind: "watch_review", actor: "watch_review", requestRef: "request", reviewRef: "review", policyRevision: 1, policyGeneration: "g" });
    expect(privateResult).toMatchObject({ refused: [expect.stringMatching(/cannot send a private/)] });
    expect(send).not.toHaveBeenCalled();
    expect(await deps.repos.sends.list("acme")).toEqual([]);
  });

  it("re-reads exact source, thread, rules and permissions before any attempt", async () => {
    const p = await propose();
    const invalid: PublicReplySnapshot[] = [
      { ...snapshotOf(), source: null },
      { ...snapshotOf(), source: { ...source, text: "Edited after review" } },
      { ...snapshotOf(), source: { ...source, threadId: 99 } },
      { ...snapshotOf(), rules: { ...snapshotOf().rules, description: "Replies require admin approval." } },
      { ...snapshotOf(), kind: "channel", canSendText: false, refusal: "BROADCAST_OR_UNSUPPORTED_CHAT" },
      { ...snapshotOf(), canSendText: false, refusal: "TEXT_NOT_PERMITTED" },
      { ...snapshotOf(), slowmodeUntil: new Date(START + 60_000).toISOString() },
      { ...snapshotOf(), source: { ...source, at: new Date(START - 49 * 3_600_000).toISOString() } },
    ];
    for (const next of invalid) {
      snapshot = next;
      expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toHaveProperty("refused");
    }
    expect(send).not.toHaveBeenCalled();
    expect(await deps.repos.sends.list("acme")).toEqual([]);
  });

  it("refuses when the provider inspection crosses the review expiry", async () => {
    const p = await propose();
    inspect.mockImplementation(async () => { clock += 31 * 60_000; return snapshot; });
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ refused: [expect.stringMatching(/expired/)] });
    expect(send).not.toHaveBeenCalled();
    expect(await deps.repos.sends.publicAttempt(p.id)).toBeNull();
  });

  it("a changed direction or review window cannot duplicate a reply to the same account/peer/message", async () => {
    const a = await propose();
    expect(await applyPublicReply(deps, "acme", a.id, a.textHash)).toHaveProperty("status", "sent");
    clock += 30_000;
    const b = await propose({ direction: "another", text: "A differently worded answer from another analysis window." });
    expect(b.id).not.toBe(a.id);
    expect(b.targetKey).toBe(a.targetKey);
    expect(await applyPublicReply(deps, "acme", b.id, b.textHash)).toHaveProperty("refused");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous timeout reserves the target across restart/review changes and only an exact receipt reconciles it", async () => {
    const p = await propose();
    send.mockRejectedValueOnce(new Error("socket timed out after delivery"));
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ status: "uncertain" });
    expect(await deps.repos.sends.publicAttempt(p.id)).toMatchObject({ status: "sending", error: "DELIVERY_UNKNOWN" });
    // A fresh repository/door sees the same durable unresolved row, without an in-memory retry flag.
    deps = { ...deps, repos: createRepos(handle.db) };
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ status: "uncertain" });
    clock += 30_000;
    const next = await propose({ text: "A new reviewed wording." });
    expect(await applyPublicReply(deps, "acme", next.id, next.textHash)).toHaveProperty("refused");
    receipt.mockResolvedValueOnce({ ...proof(p), replyToMessageId: 99 });
    expect(await reconcilePublicReply(deps, "acme", p.id, 500)).toHaveProperty("refused");
    receipt.mockResolvedValueOnce(proof(p));
    expect(await reconcilePublicReply(deps, "acme", p.id, 500)).toMatchObject({ status: "sent", messageId: "500" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("an explicit provider refusal is recorded once and propagates account FloodWait without automatic retry", async () => {
    const p = await propose();
    const flood = new PublicReplyError("refused", "FLOOD_WAIT_90", 90);
    send.mockRejectedValueOnce(flood);
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ status: "failed", reason: "FLOOD_WAIT_90" });
    expect(failed).toHaveBeenCalledExactlyOnceWith(ACCOUNT, flood);
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ status: "failed" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a mismatching provider receipt stays unresolved and never frees the target", async () => {
    const p = await propose();
    send.mockResolvedValueOnce({ ...proof(p), chatId: CHAT - 1 });
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ status: "uncertain", reason: "RECEIPT_MISMATCH" });
    expect(await deps.repos.sends.publicAttempt(p.id)).toMatchObject({ status: "sending" });
  });

  it("shares account spacing with private sends and enforces the public actor share inside the audit", async () => {
    const privateDraft = await deps.repos.messengers.createDraft({ project: "other", channel: "telegram_user", chatId: "7", text: "private reply", createdBy: "owner" });
    await deps.repos.sends.beginMessage({ project: "other", channel: "telegram_user", messengerDraftId: privateDraft.id, account: ACCOUNT, to: "telegram:7",
      name: "Known private chat", text: privateDraft.text, actor: "admin", at: new Date(clock - 5000).toISOString(), limits: { dailyCap: 30, spacingSeconds: 20 } });
    const p = await propose();
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ refused: [expect.stringMatching(/under 20 seconds/)] });
    expect(send).not.toHaveBeenCalled();
    clock += 30_000;
    policy = { ...policy, repliesPerDay: 0 };
    expect(await applyPublicReply(deps, "acme", p.id, p.textHash)).toMatchObject({ refused: [expect.stringMatching(/share of the cap is 0/)] });
    expect(await deps.repos.sends.messengerUsage("telegram_user", ACCOUNT, new Date(clock).toISOString())).toMatchObject({ sentLastDay: 1 });
  });

  it("two concurrent requests can make only one provider call", async () => {
    const p = await propose();
    const results = await Promise.all([applyPublicReply(deps, "acme", p.id, p.textHash), applyPublicReply(deps, "acme", p.id, p.textHash)]);
    expect(results.some((r) => "status" in r && r.status === "sent")).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await deps.repos.sends.list("acme")).toHaveLength(1);
  });
});
