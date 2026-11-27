import type { WatchReviewDto } from "@hub/contract/watch-review";
import { ApiFailure, sentence } from "@/lib/api/client";
import type { watchReviewApi } from "@/lib/api/project/watch-review";

type Proposal = WatchReviewDto["proposal"];
type Prepared = Awaited<ReturnType<typeof watchReviewApi.prepare>>;
export type PublicReplyResult = Awaited<ReturnType<typeof watchReviewApi.send>>;
export type PublicReplyPhase = "idle" | "preparing" | "sending";

const immutable = [
  "id", "project", "direction", "account", "groupUsername", "chatId", "replyToMessageId", "threadId",
  "text", "textHash", "payloadHash", "sourceHash", "rulesHash", "strategyHash", "policyGeneration", "reviewRef", "reviewedAt",
] as const satisfies readonly (keyof Proposal)[];

/** The fresh ticket must cover exactly what the owner just saw, including the photo and caption. */
export function preparedMatches(shown: WatchReviewDto, prepared: Prepared): boolean {
  const fresh = prepared.review;
  return fresh.state === "ready" && fresh.canPrepare
    && immutable.every((key) => shown.proposal[key] === fresh.proposal[key])
    && JSON.stringify(shown.proposal.photo) === JSON.stringify(fresh.proposal.photo)
    && prepared.payloadHash === shown.proposal.payloadHash
    && prepared.policyGeneration === fresh.currentPolicyGeneration
    && prepared.policyGeneration === fresh.proposal.policyGeneration;
}

/** A lost send response does not establish failure, and must never offer a blind retry. */
export class PublicDeliveryUnconfirmed extends Error {
  constructor(error: unknown) {
    super(`Delivery could not be confirmed. Refresh the saved status before any further action. ${sentence(error)}`);
    this.name = "PublicDeliveryUnconfirmed";
  }
}

/** A response from another proposal is not evidence that this reply was delivered. */
export function checkedReplyResult(proposalId: string, result: PublicReplyResult): PublicReplyResult {
  if ("status" in result && result.proposalId !== proposalId) throw new PublicDeliveryUnconfirmed("The response identified a different saved reply.");
  return result;
}

export async function sendReviewedReply(shown: WatchReviewDto, port: {
  prepare: () => Promise<Prepared>;
  send: (body: { ticket: string; payloadHash: string; policyGeneration: string }) => Promise<PublicReplyResult>;
  phase: (phase: PublicReplyPhase) => void;
}): Promise<PublicReplyResult> {
  if (shown.state !== "ready" || !shown.canPrepare) throw new Error("This reply is not ready for a final delivery check.");
  port.phase("preparing");
  const prepared = await port.prepare();
  if (!preparedMatches(shown, prepared)) throw new Error("The target or reviewed payload changed. Refresh the saved proposal before sending.");
  port.phase("sending");
  try {
    return checkedReplyResult(shown.proposal.id, await port.send({ ticket: prepared.ticket, payloadHash: prepared.payloadHash, policyGeneration: prepared.policyGeneration }));
  } catch (error) {
    if (error instanceof PublicDeliveryUnconfirmed || error instanceof ApiFailure && error.refused.length > 0) throw error;
    throw new PublicDeliveryUnconfirmed(error);
  }
}
