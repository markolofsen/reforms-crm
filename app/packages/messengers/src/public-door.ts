import { randomBytes } from "node:crypto";
import { unresolvedMarkers } from "@hub/config";
import { MESSENGER_DAILY_CAP, MESSENGER_SPACING_SECONDS } from "@hub/config/chat-rules";
import { RepoError, type Repos, type PublicReplyProposalRow, type SendRow } from "@hub/db";
import { ops } from "@hub/log/ops";
import { mintAuthorization, textHash } from "./authorization";
import { publicReplyError, PublicReplyError, type PublicReplySnapshot, type PublicReplySender, type PublicReplyReceipt } from "./public-reply";
import type { MtPublicTarget } from "./telegram-user";

export const PUBLIC_SOURCE_MAX_AGE_MS = 48 * 3_600_000;
export const PUBLIC_REVIEW_MAX_AGE_MS = 30 * 60_000;
const log = ops("send");
type Scope = { direction: string; groupUsername: string; account: string; chatId: number };

/** Composition combines the owner's protected Watch grant with the same project lifecycle/recipient send policy. */
export interface PublicReplyPolicy {
  refusal: string | null;
  generation: string;
  revision: number;
  requestRef: string;
  strategyHash: string;
  repliesPerDay: number;
}

export interface PublicReplyDoorDeps {
  repos: Repos;
  policy(project: string, scope: Scope): PublicReplyPolicy;
  sender(account: string): PublicReplySender | undefined;
  failed?(account: string, error: PublicReplyError): Promise<void>;
  now?: () => Date;
}

export const publicReplyHashes = (snapshot: PublicReplySnapshot): { sourceHash: string; rulesHash: string } => ({
  sourceHash: textHash(JSON.stringify([snapshot.chatId, snapshot.source])),
  rulesHash: textHash(JSON.stringify([snapshot.chatId, snapshot.rules])),
});
const targetKey = (account: string, chatId: number, messageId: number) => textHash(JSON.stringify(["telegram_user", account, chatId, messageId]));
const targetOf = (p: PublicReplyProposalRow): MtPublicTarget => ({ id: p.chatId, accessHash: p.accessHash });
const scopeOf = (p: PublicReplyProposalRow): Scope => ({ direction: p.direction, groupUsername: p.groupUsername, account: p.account, chatId: p.chatId });
const nowOf = (deps: PublicReplyDoorDeps) => (deps.now ?? (() => new Date()))();
type Refused = { refused: string[] };

function sourceReasons(s: PublicReplySnapshot, target: { chatId: number; groupUsername: string; messageId: number }, now: Date): string[] {
  const reasons: string[] = [];
  if (s.chatId !== target.chatId || s.username !== target.groupUsername) reasons.push("the public peer or username changed");
  if (s.kind !== "group") reasons.push("only an explicitly granted public group can receive a reply; channel comments need a separately granted discussion group");
  if (!s.isMember || !s.canSendText) reasons.push(s.refusal ?? "the account cannot write plain text in this group");
  if (s.slowmodeUntil && Date.parse(s.slowmodeUntil) > now.getTime()) reasons.push(`slow mode: wait until ${s.slowmodeUntil}`);
  if (!s.source || s.source.id !== target.messageId) reasons.push("the exact source message is missing or unreadable");
  else {
    const age = now.getTime() - Date.parse(s.source.at);
    if (!Number.isFinite(age) || age < -60_000 || age > PUBLIC_SOURCE_MAX_AGE_MS) reasons.push("the source is outside the 48-hour reply window");
    if (s.source.outgoing || s.source.service || !s.source.text.trim()) reasons.push("the source must be another person's readable text message");
  }
  return reasons;
}

export interface ReviewedPublicReply {
  project: string;
  direction: string;
  groupUsername: string;
  account: string;
  target: MtPublicTarget;
  messageId: number;
  text: string;
  sourceHash: string;
  rulesHash: string;
  reviewRef: string;
  reviewedAt: string;
}

/** No send: persist exactly the externally reviewed text, source/rules hashes and protected grant generation. */
export async function proposePublicReply(deps: PublicReplyDoorDeps, input: ReviewedPublicReply): Promise<{ proposal: PublicReplyProposalRow } | Refused> {
  const at = nowOf(deps);
  const scope = { direction: input.direction, groupUsername: input.groupUsername, account: input.account, chatId: input.target.id };
  const policy = deps.policy(input.project, scope);
  const reasons: string[] = policy.refusal ? [policy.refusal] : [];
  const age = at.getTime() - Date.parse(input.reviewedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > PUBLIC_REVIEW_MAX_AGE_MS) reasons.push("the external review must be from the last 30 minutes");
  if (!input.reviewRef.trim()) reasons.push("a review reference is required");
  if (!Number.isSafeInteger(input.target.id) || input.target.id >= 0 || !Number.isSafeInteger(input.messageId) || input.messageId <= 0) reasons.push("an exact public group and source message are required");
  if (!input.text.trim() || input.text.length > 4096 || unresolvedMarkers(input.text).length) reasons.push("the reviewed text must be complete plain text, at most 4096 characters");
  const sender = deps.sender(input.account);
  if (!sender) reasons.push("the sending account is not connected");
  if (reasons.length || !sender) return { refused: reasons };
  let snapshot: PublicReplySnapshot;
  try {
    snapshot = await sender.inspect(input.target, input.messageId);
  } catch (error) {
    const safe = publicReplyError(error);
    await deps.failed?.(input.account, safe);
    return { refused: [`the source/permissions could not be read: ${safe.code}`] };
  }
  reasons.push(...sourceReasons(snapshot, { chatId: input.target.id, groupUsername: input.groupUsername, messageId: input.messageId }, nowOf(deps)));
  const hashes = publicReplyHashes(snapshot);
  if (hashes.sourceHash !== input.sourceHash || hashes.rulesHash !== input.rulesHash) reasons.push("the source or group rules changed since the review; review them again");
  const freshPolicy = deps.policy(input.project, scope);
  if (freshPolicy.refusal || freshPolicy.generation !== policy.generation) reasons.push(freshPolicy.refusal ?? "the grant changed during review");
  if (reasons.length || !snapshot.source) return { refused: reasons };
  const textDigest = textHash(input.text);
  const identity = textHash(JSON.stringify([input.project, input.direction, input.account, input.target.id, input.messageId,
    snapshot.source.threadId, textDigest, hashes.sourceHash, hashes.rulesHash, policy.generation, input.reviewRef, input.reviewedAt]));
  const createdAt = nowOf(deps).toISOString();
  const proposal = await deps.repos.sends.createPublicProposal({
    id: identity, project: input.project, direction: input.direction, account: input.account, groupUsername: input.groupUsername,
    chatId: input.target.id, accessHash: input.target.accessHash, replyToMessageId: input.messageId, threadId: snapshot.source.threadId,
    targetKey: targetKey(input.account, input.target.id, input.messageId), text: input.text, textHash: textDigest,
    sourceHash: hashes.sourceHash, sourceAt: snapshot.source.at, rulesHash: hashes.rulesHash,
    policyGeneration: policy.generation, policyRevision: policy.revision, strategyHash: policy.strategyHash,
    reviewRef: input.reviewRef, reviewedAt: input.reviewedAt, createdAt,
    expiresAt: new Date(Date.parse(input.reviewedAt) + PUBLIC_REVIEW_MAX_AGE_MS).toISOString(),
    randomId: (randomBytes(8).readBigInt64BE() || 1n).toString(),
  });
  log.info("public reply: reviewed proposal stored", { project: input.project, proposal: proposal.id, actor: "watch_review" });
  return { proposal };
}

export type PublicReplyApply =
  | Refused
  | { status: "sent" | "failed" | "uncertain"; proposalId: string; sendId: number; messageId: string | null; reason: string | null };

function attemptResult(p: PublicReplyProposalRow, row: SendRow): PublicReplyApply {
  return { proposalId: p.id, sendId: row.id, status: row.status === "sent" ? "sent" : row.status === "failed" ? "failed" : "uncertain",
    messageId: row.sentMessageId, reason: row.error ?? (row.status === "sending" ? "delivery is unresolved; do not resend" : null) };
}

function receiptMatches(p: PublicReplyProposalRow, receipt: PublicReplyReceipt): boolean {
  return receipt.outgoing && receipt.chatId === p.chatId && receipt.replyToMessageId === p.replyToMessageId &&
    receipt.threadId === p.threadId && textHash(receipt.text) === p.textHash && Number.isSafeInteger(receipt.messageId) && receipt.messageId > 0;
}

/** The public target's five stages: assess, authorize, recheck, shared transactional audit, one guarded delivery. */
export async function applyPublicReply(deps: PublicReplyDoorDeps, project: string, proposalId: string, confirmedHash: string): Promise<PublicReplyApply> {
  const p = await deps.repos.sends.publicProposal(project, proposalId);
  if (!p) return { refused: ["the reviewed public proposal does not exist"] };
  if (confirmedHash !== p.textHash || textHash(p.text) !== p.textHash || targetKey(p.account, p.chatId, p.replyToMessageId) !== p.targetKey) return { refused: ["the reviewed text or target changed"] };
  const attempted = await deps.repos.sends.publicAttempt(p.id);
  if (attempted) return attemptResult(p, attempted);
  const scope = scopeOf(p);
  const policy = deps.policy(project, scope);
  const reasons = policy.refusal ? [policy.refusal] : [];
  if (policy.generation !== p.policyGeneration || policy.revision !== p.policyRevision || policy.strategyHash !== p.strategyHash) reasons.push("the protected grant, send policy or strategy changed after the review");
  if (p.expiresAt <= nowOf(deps).toISOString()) reasons.push("the reviewed proposal expired; review again");
  const sender = deps.sender(p.account);
  if (!sender) reasons.push("the sending account is not connected");
  if (await deps.repos.sends.isStopped(project)) reasons.push("Stop sending is on");
  if (reasons.length || !sender) return { refused: reasons };

  // Assessment reads Telegram now, not the cached analysis window that produced a signal.
  try {
    const snapshot = await sender.inspect(targetOf(p), p.replyToMessageId);
    reasons.push(...sourceReasons(snapshot, { chatId: p.chatId, groupUsername: p.groupUsername, messageId: p.replyToMessageId }, nowOf(deps)));
    const hashes = publicReplyHashes(snapshot);
    if (hashes.sourceHash !== p.sourceHash || hashes.rulesHash !== p.rulesHash || snapshot.source?.threadId !== p.threadId) reasons.push("the source, topic or rules changed after the review");
  } catch (error) {
    const safe = publicReplyError(error);
    await deps.failed?.(p.account, safe);
    return { refused: [`fresh source/permissions check failed: ${safe.code}`] };
  }
  if (reasons.length) return { refused: reasons };
  // The same mint as private messenger sends, with a tagged public target and its real protected grant reference.
  const auth = mintAuthorization({ targetKind: "public_reply", authority: { kind: "watch_review", actor: "watch_review",
    requestRef: policy.requestRef, policyGeneration: policy.generation, policyRevision: policy.revision, reviewRef: p.reviewRef },
    project, proposalId: p.id, account: p.account, chatId: p.chatId, accessHash: p.accessHash, replyToMessageId: p.replyToMessageId,
    threadId: p.threadId, text: p.text, textHash: p.textHash, randomId: p.randomId, policyGeneration: p.policyGeneration });
  if (p.expiresAt <= nowOf(deps).toISOString()) return { refused: ["the reviewed proposal expired during the provider check"] };
  const final = deps.policy(project, scope);
  if (final.refusal || final.generation !== auth.policyGeneration) return { refused: [final.refusal ?? "the grant changed before the audit"] };
  let audit: SendRow;
  try {
    audit = await deps.repos.sends.beginPublicReply({ project, proposalId: p.id, textHash: p.textHash, policyGeneration: p.policyGeneration,
      at: nowOf(deps).toISOString(), limits: { dailyCap: MESSENGER_DAILY_CAP, spacingSeconds: MESSENGER_SPACING_SECONDS, actorCap: final.repliesPerDay } });
  } catch (error) {
    if (error instanceof RepoError) return { refused: [error.message] };
    throw error;
  }
  // An interrupted permission grant or Stop between the audit and invocation never reaches the adapter.
  const last = deps.policy(project, scope);
  if (last.refusal || last.generation !== auth.policyGeneration || p.expiresAt <= nowOf(deps).toISOString() || await deps.repos.sends.isStopped(project)) {
    const reason = last.refusal ?? "the grant changed, the review expired or Stop sending is on";
    await deps.repos.sends.markFailed(audit.id, reason);
    return { status: "failed", proposalId: p.id, sendId: audit.id, messageId: null, reason };
  }
  try {
    const receipt = await sender.send(auth);
    if (!receiptMatches(p, receipt)) {
      await deps.repos.sends.markPublicUncertain(audit.id, "receipt target/text does not match; reconcile before any new action", String(receipt.messageId));
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

/** An unresolved delivery is only reconciled against an exact outgoing provider message. This never sends or retries. */
export async function reconcilePublicReply(deps: PublicReplyDoorDeps, project: string, proposalId: string, messageId?: number): Promise<PublicReplyApply> {
  const p = await deps.repos.sends.publicProposal(project, proposalId);
  if (!p) return { refused: ["the reviewed public proposal does not exist"] };
  const attempt = await deps.repos.sends.publicAttempt(p.id);
  if (!attempt) return { refused: ["this proposal has no send attempt"] };
  if (attempt.status !== "sending") return attemptResult(p, attempt);
  const id = messageId ?? (attempt.sentMessageId === null ? NaN : Number(attempt.sentMessageId));
  if (!Number.isSafeInteger(id) || id <= 0) return { refused: ["provide the exact Telegram message id observed after the unresolved attempt; do not resend"] };
  const sender = deps.sender(p.account);
  if (!sender) return { refused: ["the sending account is not connected"] };
  try {
    const receipt = await sender.receipt(targetOf(p), id);
    if (!receipt || !receiptMatches(p, receipt) || Date.parse(receipt.at) < Date.parse(attempt.createdAt) - 60_000) return { refused: ["the provider message does not prove this exact reply; delivery remains unresolved"] };
    await deps.repos.sends.markSent(attempt.id, String(receipt.messageId));
    return { status: "sent", proposalId: p.id, sendId: attempt.id, messageId: String(receipt.messageId), reason: null };
  } catch (error) {
    const safe = publicReplyError(error);
    await deps.failed?.(p.account, safe);
    return { refused: [`receipt could not be read: ${safe.code}; do not resend`] };
  }
}
