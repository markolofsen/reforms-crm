import { MESSENGER_DAILY_CAP, MESSENGER_SPACING_SECONDS } from "@hub/config/chat-rules";
import { usageRefusal, type PublicReplyProposalRow } from "@hub/db";
import { textHash } from "../authorization";
import { publicReplyError, type PublicReplySnapshot } from "../public-reply";
import { publicPayloadValid } from "./payload";
import { PUBLIC_SOURCE_MAX_AGE_MS, publicReplyNow, publicReplyScope, publicReplyTarget, type PublicReplyAssessment, type PublicReplyDoorDeps } from "./types";

export const publicReplyHashes = (snapshot: PublicReplySnapshot): { sourceHash: string; rulesHash: string } => ({
  sourceHash: textHash(JSON.stringify([snapshot.chatId, snapshot.source])),
  rulesHash: textHash(JSON.stringify([snapshot.chatId, snapshot.rules])),
});

export function publicSourceReasons(s: PublicReplySnapshot, target: { chatId: number; groupUsername: string; messageId: number }, now: Date, photo = false): string[] {
  const reasons: string[] = [];
  if (s.chatId !== target.chatId || s.username !== target.groupUsername) reasons.push("the public peer or username changed");
  if (s.kind !== "group") reasons.push("only an explicitly granted public group can receive a reply; channel comments need a separately granted discussion group");
  if (!s.isMember || !s.canSendText) reasons.push(s.refusal ?? "the account cannot write plain text in this group");
  if (photo && s.canSendPhotos !== true) reasons.push("photos are not permitted for this account in this group");
  if (s.slowmodeUntil && Date.parse(s.slowmodeUntil) > now.getTime()) reasons.push(`slow mode: wait until ${s.slowmodeUntil}`);
  if (!s.source || s.source.id !== target.messageId) reasons.push("the exact source message is missing or unreadable");
  else {
    const age = now.getTime() - Date.parse(s.source.at);
    if (!Number.isFinite(age) || age < -60_000 || age > PUBLIC_SOURCE_MAX_AGE_MS) reasons.push("the source is outside the 48-hour reply window");
    if (s.source.outgoing || s.source.service || !s.source.text.trim()) reasons.push("the source must be another person's readable text message");
  }
  return reasons;
}

async function budgetReasons(deps: PublicReplyDoorDeps, p: PublicReplyProposalRow, cap: number, at: string): Promise<string[]> {
  const reasons: string[] = [];
  const used = await deps.repos.sends.messengerUsage("telegram_user", p.account, at);
  const refusal = usageRefusal(used, { dailyCap: MESSENGER_DAILY_CAP, spacingSeconds: MESSENGER_SPACING_SECONDS }, at);
  if (refusal) reasons.push(refusal);
  const publicUsed = await deps.repos.sends.publicReplyUsage(p.account, at);
  if (publicUsed >= cap) reasons.push(`watch_review sent ${publicUsed} messages on this account in the last 24 hours, its share of the cap is ${cap}`);
  if (await deps.repos.sends.publicTargetReserved(p.targetKey)) reasons.push("this public source already has a live reply attempt; do not resend");
  return reasons;
}

/** Stored mode never contacts Telegram. Fresh mode validates local bytes and provider context, never uploads/mints/audits. */
export async function assessPublicReply(deps: PublicReplyDoorDeps, project: string, proposalId: string, options: { fresh: boolean }): Promise<PublicReplyAssessment | null> {
  const p = await deps.repos.sends.publicProposal(project, proposalId);
  if (!p) return null;
  let policy = deps.policy(project, publicReplyScope(p));
  const attempt = await deps.repos.sends.publicAttempt(p.id);
  if (attempt) return { proposal: p, policy, attempt,
    state: attempt.status === "sent" ? "sent" : attempt.status === "failed" ? "failed" : "uncertain",
    reasons: attempt.status === "sent" ? [] : [attempt.error ?? "delivery is unresolved; do not resend"] };
  const reasons = policy.refusal ? [policy.refusal] : [];
  let stale = !publicPayloadValid(p);
  if (stale) reasons.push("the reviewed payload or target changed");
  const at = publicReplyNow(deps);
  if (policy.generation !== p.policyGeneration || policy.revision !== p.policyRevision || policy.strategyHash !== p.strategyHash) {
    reasons.push("the protected grant, send policy or strategy changed after the review"); stale = true;
  }
  const age = at.getTime() - Date.parse(p.sourceAt);
  if (!Number.isFinite(age) || age < -60_000 || age > PUBLIC_SOURCE_MAX_AGE_MS) { reasons.push("the source is outside the 48-hour reply window"); stale = true; }
  if (p.expiresAt <= at.toISOString()) { reasons.push("the reviewed proposal expired; review again"); stale = true; }
  const sender = deps.sender(p.account);
  if (!sender) reasons.push("the sending account is not connected");
  if (await deps.repos.sends.isStopped(project)) reasons.push("Stop sending is on");
  if (p.photo && !policy.photoReplies) reasons.push("the protected grant does not allow photo replies");
  if (p.photo && (!deps.assets || !sender?.preparePhoto)) reasons.push("verified photo delivery is unavailable");
  reasons.push(...await budgetReasons(deps, p, policy.repliesPerDay, at.toISOString()));
  if (options.fresh && !reasons.length && sender) {
    if (p.photo && deps.assets) {
      try { await deps.assets.read(project, p.photo); }
      catch { reasons.push("the exact reviewed photo is missing, changed or invalid"); stale = true; }
    }
    if (!reasons.length) {
      try {
        const snapshot = await sender.inspect(publicReplyTarget(p), p.replyToMessageId);
        reasons.push(...publicSourceReasons(snapshot, { chatId: p.chatId, groupUsername: p.groupUsername, messageId: p.replyToMessageId }, publicReplyNow(deps), p.photo !== null));
        const hashes = publicReplyHashes(snapshot);
        if (hashes.sourceHash !== p.sourceHash || hashes.rulesHash !== p.rulesHash || snapshot.source?.threadId !== p.threadId) {
          reasons.push("the source, topic or rules changed after the review"); stale = true;
        }
      } catch (error) {
        const safe = publicReplyError(error);
        await deps.failed?.(p.account, safe);
        reasons.push(`fresh source/permissions check failed: ${safe.code}`);
      }
    }
  }
  if (p.expiresAt <= publicReplyNow(deps).toISOString() && !reasons.some((r) => r.includes("expired"))) {
    reasons.push("the reviewed proposal expired during the provider check"); stale = true;
  }
  policy = deps.policy(project, publicReplyScope(p));
  if ((policy.refusal || policy.generation !== p.policyGeneration) && !reasons.some((r) => r.includes("grant"))) {
    reasons.push(policy.refusal ?? "the protected grant changed during assessment"); stale = true;
  }
  return { proposal: p, policy, attempt: null, reasons, state: stale ? "stale" : reasons.length ? "held" : "ready" };
}
