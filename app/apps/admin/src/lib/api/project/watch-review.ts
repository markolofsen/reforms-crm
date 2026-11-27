import { getGetWatchProposalPhotoUrl, getWatchProposalReview, listWatchProposals, prepareWatchProposal, reconcileWatchProposal, sendWatchProposal } from "@hub/api";
import { watchReplyResultDto } from "@hub/contract/watch-actions";
import { watchReviewDto, watchReviewListDto, watchReviewPreparedDto } from "@hub/contract/watch-review";
import { readGenerated } from "../client";

/** Public reply review has its own exact-origin ticket door; it never creates a proposal or accepts source rules. */
export const watchReviewApi = {
  list: (project: string, q: { direction: string; group: string; messageId: number }) =>
    readGenerated(listWatchProposals(project, q), watchReviewListDto),
  get: (project: string, id: string) => readGenerated(getWatchProposalReview(project, id), watchReviewDto),
  prepare: (project: string, id: string, payloadHash: string) =>
    readGenerated(prepareWatchProposal(project, id, { payloadHash }), watchReviewPreparedDto),
  send: (project: string, id: string, body: { ticket: string; payloadHash: string; policyGeneration: string }) =>
    readGenerated(sendWatchProposal(project, id, body), watchReplyResultDto, [200, 202]),
  reconcile: (project: string, id: string) => readGenerated(reconcileWatchProposal(project, id, {}), watchReplyResultDto),
  photoUrl: (project: string, id: string): string => getGetWatchProposalPhotoUrl(project, id),
};
