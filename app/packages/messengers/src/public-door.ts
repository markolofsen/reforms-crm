import { MESSENGER_DAILY_CAP, MESSENGER_SPACING_SECONDS } from "@hub/config/chat-rules";
import { RepoError, type PublicReplyProposalRow, type SendRow } from "@hub/db";
import { ops } from "@hub/log/ops";
import { mintAuthorization, textHash } from "./authorization";
import { publicReplyError, PublicReplyError, type PreparedPublicPhoto, type PublicReplyReceipt, type PublicReplySender } from "./public-reply";
import { assessPublicReply } from "./public-replies/assessment";
import { publicPayloadValid, publicReplyPayloadHash } from "./public-replies/payload";
import { publicReplyNow, publicReplyScope, publicReplyTarget, type PublicReplyApply, type PublicReplyDoorDeps, type PublicReplyPolicy, type PublicReplyRefused } from "./public-replies/types";

export { assessPublicReply, publicReplyHashes } from "./public-replies/assessment";
export { publicReplyPayloadHash } from "./public-replies/payload";
export { proposePublicReply } from "./public-replies/proposal";
export { PUBLIC_SOURCE_MAX_AGE_MS, PUBLIC_REVIEW_MAX_AGE_MS, type PublicReplyApply, type PublicReplyDoorDeps, type PublicReplyPolicy, type PublicReplyAssessment, type ReviewedPublicReply } from "./public-replies/types";

const log = ops("send");
function attemptResult(p: PublicReplyProposalRow, row: SendRow): PublicReplyApply {
  return { proposalId: p.id, sendId: row.id, status: row.status === "sent" ? "sent" : row.status === "failed" ? "failed" : "uncertain",
    messageId: row.sentMessageId, reason: row.error ?? (row.status === "sending" ? "delivery is unresolved; do not resend" : null) };
}

function receiptMatches(p: PublicReplyProposalRow, receipt: PublicReplyReceipt, photo: PreparedPublicPhoto | null): boolean {
  const media = p.photo ? !!photo && photo.assetHash === p.photo.sha256 && photo.account === p.account &&
    receipt.mediaType === "photo" && receipt.photoId === photo.photoId : receipt.mediaType == null && receipt.photoId == null;
  return media && receipt.outgoing && receipt.chatId === p.chatId && receipt.replyToMessageId === p.replyToMessageId &&
    receipt.threadId === p.threadId && textHash(receipt.text) === p.textHash && Number.isFinite(Date.parse(receipt.at)) &&
    Number.isSafeInteger(receipt.messageId) && receipt.messageId > 0;
}

/** The same internal authorization mint; upload capability has no prepared identity and cannot publish a photo. */
function authorizationOf(p: PublicReplyProposalRow, policy: PublicReplyPolicy, preparedPhoto: PreparedPublicPhoto | null) {
  return mintAuthorization({ targetKind: "public_reply", authority: { kind: "watch_review", actor: "watch_review",
    requestRef: policy.requestRef, policyGeneration: policy.generation, policyRevision: policy.revision, reviewRef: p.reviewRef },
    project: p.project, proposalId: p.id, account: p.account, chatId: p.chatId, accessHash: p.accessHash, replyToMessageId: p.replyToMessageId,
    threadId: p.threadId, text: p.text, textHash: p.textHash, payloadHash: publicReplyPayloadHash(p), photo: p.photo,
    preparedPhoto: preparedPhoto ? { account: preparedPhoto.account, assetHash: preparedPhoto.assetHash, photoId: preparedPhoto.photoId,
      accessHash: preparedPhoto.accessHash, fileReference: preparedPhoto.fileReference } : null,
    randomId: p.randomId, policyGeneration: p.policyGeneration });
}

/** No public post: upload exact verified bytes, then persist the provider identity before any audit/send can start. */
async function preparePhoto(deps: PublicReplyDoorDeps, p: PublicReplyProposalRow, policy: PublicReplyPolicy, sender: PublicReplySender): Promise<{ photo: PreparedPublicPhoto | null } | PublicReplyRefused> {
  if (!p.photo) return { photo: null };
  const existing = await deps.repos.sends.publicPhoto(p.project, p.id);
  if (existing) return existing.assetHash === p.photo.sha256 && existing.account === p.account ? { photo: existing } : { refused: ["the prepared photo does not match the reviewed asset/account"] };
  if (!deps.assets || !sender.preparePhoto) return { refused: ["verified photo delivery is unavailable"] };
  try {
    const asset = await deps.assets.read(p.project, p.photo);
    const stopped = await deps.repos.sends.isStopped(p.project);
    const current = deps.policy(p.project, publicReplyScope(p));
    if (stopped || current.refusal || !current.photoReplies || current.generation !== policy.generation || p.expiresAt <= publicReplyNow(deps).toISOString()) {
      return { refused: ["the grant changed, the review expired or Stop sending is on before photo preparation"] };
    }
    const prepared = await sender.preparePhoto(authorizationOf(p, current, null), asset.bytes);
    const saved = await deps.repos.sends.preparePublicPhoto({ ...prepared, proposalId: p.id, project: p.project, createdAt: publicReplyNow(deps).toISOString() });
    log.info("public reply: photo identity prepared", { project: p.project, proposal: p.id, actor: "watch_review" });
    return { photo: saved };
  } catch (error) {
    const safe = publicReplyError(error);
    await deps.failed?.(p.account, safe);
    log.warn("public reply: photo preparation refused", { project: p.project, proposal: p.id, code: safe.code });
    return { refused: [`the photo could not be prepared: ${safe.code}; no public send was attempted`] };
  }
}

/** Assessment, authorization, final checks, shared audit, one delivery. The caller holds the canonical account queue. */
export async function applyPublicReply(deps: PublicReplyDoorDeps, project: string, proposalId: string, confirmedHash: string): Promise<PublicReplyApply> {
  const initial = await deps.repos.sends.publicProposal(project, proposalId);
  if (!initial) return { refused: ["the reviewed public proposal does not exist"] };
  if (confirmedHash !== publicReplyPayloadHash(initial) || !publicPayloadValid(initial)) return { refused: ["the reviewed payload or target changed"] };
  const attempted = await deps.repos.sends.publicAttempt(initial.id);
  if (attempted) return attemptResult(initial, attempted);
  let assessment = await assessPublicReply(deps, project, proposalId, { fresh: true });
  if (!assessment) return { refused: ["the reviewed public proposal does not exist"] };
  if (assessment.attempt) return attemptResult(assessment.proposal, assessment.attempt);
  if (assessment.reasons.length) return { refused: assessment.reasons };
  const sender = deps.sender(assessment.proposal.account);
  if (!sender) return { refused: ["the sending account is not connected"] };
  const prepared = await preparePhoto(deps, assessment.proposal, assessment.policy, sender);
  if ("refused" in prepared) return prepared;
  // Upload may take seconds: source/rules/rights, policy and expiry are all checked again after it.
  if (assessment.proposal.photo) {
    const refreshed = await assessPublicReply(deps, project, proposalId, { fresh: true });
    if (!refreshed) return { refused: ["the reviewed public proposal does not exist"] };
    assessment = refreshed;
    if (assessment.attempt) return attemptResult(assessment.proposal, assessment.attempt);
    if (assessment.reasons.length) return { refused: assessment.reasons };
  }
  const p = assessment.proposal;
  if (confirmedHash !== publicReplyPayloadHash(p)) return { refused: ["the reviewed payload changed"] };
  const auth = authorizationOf(p, assessment.policy, prepared.photo);
  const final = deps.policy(project, publicReplyScope(p));
  if (p.expiresAt <= publicReplyNow(deps).toISOString()) return { refused: ["the reviewed proposal expired before the audit"] };
  if (final.refusal || final.generation !== auth.policyGeneration || (p.photo && !final.photoReplies)) return { refused: [final.refusal ?? "the grant changed before the audit"] };
  let audit: SendRow;
  try {
    audit = await deps.repos.sends.beginPublicReply({ project, proposalId: p.id, textHash: p.textHash, payloadHash: publicReplyPayloadHash(p),
      policyGeneration: p.policyGeneration, at: publicReplyNow(deps).toISOString(),
      limits: { dailyCap: MESSENGER_DAILY_CAP, spacingSeconds: MESSENGER_SPACING_SECONDS, actorCap: final.repliesPerDay } });
  } catch (error) {
    if (error instanceof RepoError) return { refused: [error.message] };
    throw error;
  }
  const stopped = await deps.repos.sends.isStopped(project);
  const last = deps.policy(project, publicReplyScope(p));
  if (last.refusal || last.generation !== auth.policyGeneration || (p.photo && !last.photoReplies) || stopped || p.expiresAt <= publicReplyNow(deps).toISOString() || !deps.sender(p.account)) {
    const reason = last.refusal ?? "the grant changed, the review expired, the account disconnected or Stop sending is on";
    await deps.repos.sends.markFailed(audit.id, reason);
    return { status: "failed", proposalId: p.id, sendId: audit.id, messageId: null, reason };
  }
  try {
    const receipt = await sender.send(auth);
    if (!receiptMatches(p, receipt, prepared.photo)) {
      await deps.repos.sends.markPublicUncertain(audit.id, "receipt target/payload does not match; reconcile before any new action", String(receipt.messageId));
      return { status: "uncertain", proposalId: p.id, sendId: audit.id, messageId: String(receipt.messageId), reason: "RECEIPT_MISMATCH" };
    }
    await deps.repos.sends.markSent(audit.id, String(receipt.messageId));
    log.info("public reply: sent with provider receipt", { project, proposal: p.id, send: audit.id, actor: "watch_review" });
    return { status: "sent", proposalId: p.id, sendId: audit.id, messageId: String(receipt.messageId), reason: null };
  } catch (error) {
    const normalized = publicReplyError(error);
    const safe = error instanceof PublicReplyError ? error : new PublicReplyError("uncertain", normalized.code, normalized.retryAfterSeconds);
    if (safe.outcome === "refused") await deps.repos.sends.markFailed(audit.id, safe.code);
    else await deps.repos.sends.markPublicUncertain(audit.id, safe.code, safe.messageId === null ? null : String(safe.messageId));
    await deps.failed?.(p.account, safe);
    log.warn("public reply: provider outcome, no retry", { project, proposal: p.id, send: audit.id, outcome: safe.outcome, code: safe.code });
    return { status: safe.outcome === "refused" ? "failed" : "uncertain", proposalId: p.id, sendId: audit.id, messageId: safe.messageId === null ? null : String(safe.messageId), reason: safe.code };
  }
}

/** Reconcile exact outgoing provider evidence; never sends, refreshes a file reference or creates a new random id. */
export async function reconcilePublicReply(deps: PublicReplyDoorDeps, project: string, proposalId: string, messageId?: number): Promise<PublicReplyApply> {
  const p = await deps.repos.sends.publicProposal(project, proposalId);
  if (!p) return { refused: ["the reviewed public proposal does not exist"] };
  const attempt = await deps.repos.sends.publicAttempt(p.id);
  if (!attempt) return { refused: ["this proposal has no send attempt"] };
  if (attempt.status !== "sending") return attemptResult(p, attempt);
  const knownId = attempt.sentMessageId === null ? null : Number(attempt.sentMessageId);
  if (knownId !== null && Number.isSafeInteger(knownId) && knownId > 0 && messageId !== undefined && messageId !== knownId) {
    return { refused: ["the observed message id differs from the provider id recorded for this attempt"] };
  }
  const id = messageId ?? knownId ?? NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return { refused: ["provide the exact Telegram message id observed after the unresolved attempt; do not resend"] };
  const sender = deps.sender(p.account);
  if (!sender) return { refused: ["the sending account is not connected"] };
  const photo = p.photo ? await deps.repos.sends.publicPhoto(project, p.id) : null;
  if (p.photo && !photo) return { refused: ["the prepared photo identity is unknown; delivery remains unresolved"] };
  try {
    const receipt = await sender.receipt(publicReplyTarget(p), id);
    if (!receipt || receipt.messageId !== id || !receiptMatches(p, receipt, photo) || Date.parse(receipt.at) < Date.parse(attempt.createdAt) - 60_000) return { refused: ["the provider message does not prove this exact reply; delivery remains unresolved"] };
    await deps.repos.sends.markSent(attempt.id, String(receipt.messageId));
    return { status: "sent", proposalId: p.id, sendId: attempt.id, messageId: String(receipt.messageId), reason: null };
  } catch (error) {
    const safe = publicReplyError(error);
    await deps.failed?.(p.account, safe);
    return { refused: [`receipt could not be read: ${safe.code}; do not resend`] };
  }
}
