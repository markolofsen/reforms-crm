"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { WatchReviewDto } from "@hub/contract/watch-review";
import { watchReviewApi } from "@/lib/api/project/watch-review";
import { keys } from "@/lib/cache/keys";
import { useCommand } from "@/lib/cache/topics";
import { checkedReplyResult, sendReviewedReply, type PublicReplyPhase } from "./send";

export const useWatchProposals = (project: string, direction: string, group: string, messageId: number) =>
  useQuery({ queryKey: keys.watchPublicSource(project, direction, group, messageId), queryFn: () => watchReviewApi.list(project, { direction, group, messageId }) });

/** The browser uses a generated file URL bound to a stored proposal, never a local path or caller-supplied image URL. */
export const watchProposalPhotoUrl = (project: string, id: string): string => watchReviewApi.photoUrl(project, id);

/** No send retry and no success inference from a resolved Promise. Every outcome refreshes the durable read. */
export function useWatchReplyActions(project: string, review: WatchReviewDto) {
  const [phase, setPhase] = useState<PublicReplyPhase>("idle");
  const inFlight = useRef(false);
  const send = useCommand({
    project, touches: ["watch", "sends"], retry: false,
    run: async (_: void) => {
      if (inFlight.current) throw new Error("A delivery check is already in progress.");
      inFlight.current = true;
      try {
        return await sendReviewedReply(review, {
          prepare: () => watchReviewApi.prepare(project, review.proposal.id, review.proposal.payloadHash),
          send: (body) => watchReviewApi.send(project, review.proposal.id, body),
          phase: setPhase,
        });
      } finally {
        inFlight.current = false;
        setPhase("idle");
      }
    },
  });
  const reconcile = useCommand({
    project, touches: ["watch", "sends"], retry: false,
    run: (_: void) => {
      if (!review.canReconcile) throw new Error("No verified outgoing message is available for reconciliation. Refresh the saved status.");
      return watchReviewApi.reconcile(project, review.proposal.id).then((result) => checkedReplyResult(review.proposal.id, result));
    },
  });
  const latest = reconcile.submittedAt > send.submittedAt ? reconcile : send;
  return {
    phase, pending: send.isPending || reconcile.isPending, result: latest.data, error: latest.error,
    send: () => send.mutateAsync(undefined), reconcile: () => reconcile.mutateAsync(undefined),
    reset: () => { send.reset(); reconcile.reset(); },
  };
}
