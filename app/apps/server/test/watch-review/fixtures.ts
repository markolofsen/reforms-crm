import type { WatchReviewDto } from "@hub/contract/watch-review";
import type { PublicReplyProposalRow, SendRow } from "@hub/db";

export const ID = "a".repeat(64);
export const PAYLOAD = "b".repeat(64);
export const POLICY = "c".repeat(64);
export const AT = "2026-11-27T12:00:00.000Z";

export function reviewFixture(): WatchReviewDto {
  return {
    proposal: {
      id: ID, project: "acme", direction: "default", account: "42", groupUsername: "public_group",
      chatId: -100123, replyToMessageId: 70, threadId: null, text: "An explicitly reviewed public answer.",
      textHash: PAYLOAD, payloadHash: PAYLOAD, photo: null, sourceHash: "d".repeat(64), sourceAt: AT,
      rulesHash: "e".repeat(64), policyGeneration: POLICY, policyRevision: 2, strategyHash: "f".repeat(64),
      reviewRef: "reports/review.md#70", reviewedAt: AT, createdAt: AT, expiresAt: "2026-11-27T12:30:00.000Z", attempt: null,
    },
    state: "ready", reasons: [], observedAt: AT, currentPolicyGeneration: POLICY, canPrepare: true, canReconcile: false,
    sourceLink: "https://t.me/public_group/70", receiptLink: null,
  };
}

export function storedProposal(): PublicReplyProposalRow {
  const p = reviewFixture().proposal;
  return { id: p.id, project: p.project, direction: p.direction, account: p.account, groupUsername: p.groupUsername,
    chatId: p.chatId, replyToMessageId: p.replyToMessageId, threadId: p.threadId, text: p.text, textHash: p.textHash,
    payloadHash: null, photo: p.photo, sourceHash: p.sourceHash, sourceAt: p.sourceAt, rulesHash: p.rulesHash,
    policyGeneration: p.policyGeneration, policyRevision: p.policyRevision, strategyHash: p.strategyHash,
    reviewRef: p.reviewRef, reviewedAt: p.reviewedAt, createdAt: p.createdAt, expiresAt: p.expiresAt,
    accessHash: "private-peer-hash", targetKey: "private-target-key", randomId: "private-random-id" };
}

export function sendAttempt(): SendRow {
  return { id: 9, project: "acme", draftId: null, mode: "manual", status: "sending", actor: "watch_review",
    createdAt: AT, dueAt: null, doneAt: null, sender: "42", toAddr: "telegram_user:-100123", ccAddr: null, bccAddr: null,
    subject: "public_group", body: "An explicitly reviewed public answer.", mailRef: null, sentMessageId: null,
    error: "DELIVERY_UNKNOWN", channel: "telegram_user", messengerDraftId: null, ownerWord: null, publicProposalId: ID,
    publicTargetKey: "private-target-key" };
}
