import { randomBytes } from "node:crypto";
import { unresolvedMarkers } from "@hub/config";
import { WATCH_PHOTO_LIMITS, watchPhotoAsset } from "@hub/contract/watch-media";
import type { PublicReplyProposalRow } from "@hub/db";
import { ops } from "@hub/log/ops";
import { textHash } from "../authorization";
import { publicReplyError, type PublicReplySnapshot } from "../public-reply";
import { publicReplyHashes, publicSourceReasons } from "./assessment";
import { publicReplyTargetKey, reviewedPublicPayloadHash } from "./payload";
import { PUBLIC_REVIEW_MAX_AGE_MS, publicReplyNow, type PublicReplyDoorDeps, type PublicReplyRefused, type ReviewedPublicReply } from "./types";

const log = ops("send");

/** Persist exact external review only. Asset validity is a local read; proposing never uploads or sends. */
export async function proposePublicReply(deps: PublicReplyDoorDeps, input: ReviewedPublicReply): Promise<{ proposal: PublicReplyProposalRow } | PublicReplyRefused> {
  const at = publicReplyNow(deps);
  const scope = { direction: input.direction, groupUsername: input.groupUsername, account: input.account, chatId: input.target.id };
  const policy = deps.policy(input.project, scope);
  const reasons: string[] = policy.refusal ? [policy.refusal] : [];
  const age = at.getTime() - Date.parse(input.reviewedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > PUBLIC_REVIEW_MAX_AGE_MS) reasons.push("the external review must be from the last 30 minutes");
  if (!input.reviewRef.trim()) reasons.push("a review reference is required");
  if (!Number.isSafeInteger(input.target.id) || input.target.id >= 0 || !Number.isSafeInteger(input.messageId) || input.messageId <= 0) reasons.push("an exact public group and source message are required");
  const limit = input.photo ? WATCH_PHOTO_LIMITS.caption : 4096;
  if (!input.text.trim() || input.text.length > limit || unresolvedMarkers(input.text).length) reasons.push(`the reviewed text must be complete plain text, at most ${limit} characters`);
  const sender = deps.sender(input.account);
  if (!sender) reasons.push("the sending account is not connected");
  const parsed = input.photo === undefined ? null : watchPhotoAsset.safeParse(input.photo);
  if (parsed && !parsed.success) reasons.push("the reviewed photo descriptor is invalid");
  const photo = parsed?.success ? parsed.data : null;
  if (photo && !policy.photoReplies) reasons.push("the protected grant does not allow photo replies");
  if (photo && (!deps.assets || !sender?.preparePhoto)) reasons.push("verified photo delivery is unavailable");
  if (reasons.length || !sender) return { refused: reasons };
  if (photo && deps.assets) {
    try { await deps.assets.read(input.project, photo); }
    catch { return { refused: ["the exact reviewed photo is missing, changed or invalid"] }; }
  }
  let snapshot: PublicReplySnapshot;
  try { snapshot = await sender.inspect(input.target, input.messageId); }
  catch (error) {
    const safe = publicReplyError(error);
    await deps.failed?.(input.account, safe);
    return { refused: [`the source/permissions could not be read: ${safe.code}`] };
  }
  reasons.push(...publicSourceReasons(snapshot, { chatId: input.target.id, groupUsername: input.groupUsername, messageId: input.messageId }, publicReplyNow(deps), photo !== null));
  const hashes = publicReplyHashes(snapshot);
  if (hashes.sourceHash !== input.sourceHash || hashes.rulesHash !== input.rulesHash) reasons.push("the source or group rules changed since the review; review them again");
  const freshPolicy = deps.policy(input.project, scope);
  if (freshPolicy.refusal || freshPolicy.generation !== policy.generation) reasons.push(freshPolicy.refusal ?? "the grant changed during review");
  if (Date.parse(input.reviewedAt) + PUBLIC_REVIEW_MAX_AGE_MS <= publicReplyNow(deps).getTime()) reasons.push("the reviewed proposal expired during the provider check");
  if (reasons.length || !snapshot.source) return { refused: reasons };
  const textDigest = textHash(input.text);
  const payloadHash = reviewedPublicPayloadHash(input.text, photo);
  // For plain text payloadHash equals textHash: legacy proposal identity and persistent random id remain stable.
  const identity = textHash(JSON.stringify([input.project, input.direction, input.account, input.target.id, input.messageId,
    snapshot.source.threadId, payloadHash, hashes.sourceHash, hashes.rulesHash, policy.generation, input.reviewRef, input.reviewedAt]));
  const createdAt = publicReplyNow(deps).toISOString();
  const proposal = await deps.repos.sends.createPublicProposal({
    id: identity, project: input.project, direction: input.direction, account: input.account, groupUsername: input.groupUsername,
    chatId: input.target.id, accessHash: input.target.accessHash, replyToMessageId: input.messageId, threadId: snapshot.source.threadId,
    targetKey: publicReplyTargetKey(input.account, input.target.id, input.messageId), text: input.text, textHash: textDigest, payloadHash, photo,
    sourceHash: hashes.sourceHash, sourceAt: snapshot.source.at, rulesHash: hashes.rulesHash,
    policyGeneration: policy.generation, policyRevision: policy.revision, strategyHash: policy.strategyHash,
    reviewRef: input.reviewRef, reviewedAt: input.reviewedAt, createdAt,
    expiresAt: new Date(Date.parse(input.reviewedAt) + PUBLIC_REVIEW_MAX_AGE_MS).toISOString(),
    randomId: (randomBytes(8).readBigInt64BE() || 1n).toString(),
  });
  log.info("public reply: reviewed proposal stored", { project: input.project, proposal: proposal.id, actor: "watch_review" });
  return { proposal };
}
