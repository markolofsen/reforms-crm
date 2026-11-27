import type { WatchReviewDto, WatchReviewListDto } from "@hub/contract/watch-review";
import { sentence } from "@/lib/api/client";
import { PublicDeliveryUnconfirmed, type PublicReplyResult } from "@/lib/data/watch/send";

export const REVIEW_LABEL: Record<WatchReviewDto["state"], string> = {
  ready: "Ready for review", held: "On hold", stale: "Review expired or changed",
  unresolved: "Delivery not confirmed", sent: "Sent", failed: "Delivery failed",
};

/** An unexpected response must not display another source's proposal or give it a send control. */
export function matchesReviewSource(data: WatchReviewListDto, target: { project: string; direction: string; group: string; messageId: number }): boolean {
  return data.project === target.project && data.direction === target.direction && data.group.toLowerCase() === target.group.toLowerCase()
    && data.messageId === target.messageId
    && data.items.every(({ proposal: p }) => p.project === target.project && p.direction === target.direction
      && p.groupUsername.toLowerCase() === target.group.toLowerCase() && p.replyToMessageId === target.messageId);
}

/** A receipt or durable outcome outranks an older request error; an HTTP success alone never establishes delivery. */
export function replyDisplay(review: WatchReviewDto, result: PublicReplyResult | undefined, error: unknown, readStale = false) {
  let state = review.state;
  const reasons = [...review.reasons];
  if (state !== "sent") {
    if (result && "status" in result && result.status === "sent") {
      state = result.messageId ? "sent" : "unresolved";
      if (!result.messageId) reasons.push("The response has no delivery receipt. Refresh the saved status.");
    } else if (state !== "failed" && state !== "unresolved") {
      if (error instanceof PublicDeliveryUnconfirmed) state = "unresolved";
      else if (result && "status" in result) state = result.status === "uncertain" ? "unresolved" : result.status;
      else if (error || result && "refused" in result) state = "held";
    }
    if (state !== "sent") {
      if (error) reasons.push(sentence(error));
      if (result && "refused" in result) reasons.push(...result.refused);
      if (result && "status" in result && result.reason) reasons.push(result.reason);
    }
  }
  if (state === "ready" && (readStale || !review.canPrepare)) {
    state = "held";
    reasons.push(readStale ? "The latest review could not be read. Refresh the saved status." : "The server has not made this reply eligible for a final check.");
  }
  return { state, label: REVIEW_LABEL[state], reasons: [...new Set(reasons)], canReview: state === "ready" && review.canPrepare && !readStale };
}
