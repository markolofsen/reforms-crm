import type { PublicReplyProposalRow, SendRow } from "@hub/db";
import { publicReplyPayloadHash, type assessPublicReply } from "@hub/messengers/door";
import { watchProposalDto } from "@hub/contract/watch-actions";
import type { WatchReviewDto } from "@hub/contract/watch-review";

type Assessment = NonNullable<Awaited<ReturnType<typeof assessPublicReply>>>;

/** Only public review facts cross the wire. Prepared provider ids, random id, access hash and storage paths stay inside. */
export function publicProposalDto(p: PublicReplyProposalRow, attempt: SendRow | null) {
  return watchProposalDto.parse({
    id: p.id, project: p.project, direction: p.direction, account: p.account, groupUsername: p.groupUsername,
    chatId: p.chatId, replyToMessageId: p.replyToMessageId, threadId: p.threadId,
    text: p.text, textHash: p.textHash, payloadHash: publicReplyPayloadHash(p), photo: p.photo ?? null,
    sourceHash: p.sourceHash, sourceAt: p.sourceAt, rulesHash: p.rulesHash, policyGeneration: p.policyGeneration,
    policyRevision: p.policyRevision, strategyHash: p.strategyHash, reviewRef: p.reviewRef,
    reviewedAt: p.reviewedAt, createdAt: p.createdAt, expiresAt: p.expiresAt,
    attempt: attempt ? { id: attempt.id, status: attempt.status, messageId: attempt.sentMessageId, reason: attempt.error } : null,
  });
}

function storedMessageId(value: string | null | undefined): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function knownReceiptId(attempt: { status: string; sentMessageId: string | null } | null): number | null {
  return attempt?.status === "sending" ? storedMessageId(attempt.sentMessageId) : null;
}

/** This projection reads local facts only. Fresh provider assessment belongs to an explicit Prepare/Send action. */
export function publicReviewDto(a: Assessment, observedAt: string, queueReason: string | null): WatchReviewDto {
  const p = a.proposal;
  const reasons = [...a.reasons];
  let state: WatchReviewDto["state"] = a.state === "uncertain" ? "unresolved" : a.state;
  const sentId = a.attempt?.status === "sent" ? storedMessageId(a.attempt.sentMessageId) : null;
  if (state === "sent" && sentId === null) {
    state = "unresolved";
    reasons.push("The saved send has no valid provider receipt id. Delivery remains unresolved; refresh the status and do not resend.");
  }
  if (queueReason && state === "ready") {
    state = "held";
    reasons.push(queueReason);
  } else if (queueReason && state === "unresolved") reasons.push(queueReason);
  const link = (id: number) => "https://t.me/" + p.groupUsername + "/" + id;
  return {
    proposal: publicProposalDto(p, a.attempt), state, reasons, observedAt,
    currentPolicyGeneration: a.policy.generation === "unavailable" ? null : a.policy.generation,
    canPrepare: state === "ready" && queueReason === null,
    canReconcile: state === "unresolved" && knownReceiptId(a.attempt) !== null && queueReason === null,
    sourceLink: link(p.replyToMessageId),
    receiptLink: state === "sent" && sentId !== null ? link(sentId) : null,
  };
}
