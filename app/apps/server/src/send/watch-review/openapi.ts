import { watchActionParam, watchProposalParam, watchReplyResultDto } from "@hub/contract/watch-actions";
import { watchReviewDto, watchReviewListDto, watchReviewListQuery, watchReviewPrepareBody, watchReviewPreparedDto, watchReviewSendBody, watchReviewReconcileBody } from "@hub/contract/watch-review";
import type { Operation } from "../../http/openapi";

const collection = "/api/projects/:slug/watch/proposals";
const proposal = collection + "/:id";

/** Browser reads and owner-confirmed actions; the local CLI token door is not exposed by these operations. */
export const operations: Operation[] = [
  { method: "get", path: collection, operationId: "listWatchProposals", summary: "Read bounded immutable proposals for one exact Watch source", tags: ["watch"], params: watchActionParam, query: watchReviewListQuery, reply: { name: "WatchReviewList", schema: watchReviewListDto }, errors: [400, 404, 409, 503] },
  { method: "get", path: proposal, operationId: "getWatchProposalReview", summary: "Read a public proposal's eligibility and durable outcome", tags: ["watch"], params: watchProposalParam, reply: { name: "WatchReview", schema: watchReviewDto }, errors: [400, 404, 409, 503] },
  { method: "get", path: proposal + "/photo", operationId: "getWatchProposalPhoto", summary: "Read only the verified photo bound to this immutable proposal", tags: ["watch"], params: watchProposalParam, reply: { media: "image/*" }, errors: [400, 404, 409, 503] },
  { method: "post", path: proposal + "/prepare", operationId: "prepareWatchProposal", summary: "Check the reviewed payload without publishing and issue one short owner ticket", tags: ["watch"], params: watchProposalParam, body: { name: "WatchReviewPrepareBody", schema: watchReviewPrepareBody }, reply: { name: "WatchReviewPrepared", schema: watchReviewPreparedDto }, errors: [400, 403, 404, 409, 503] },
  { method: "post", path: proposal + "/send", operationId: "sendWatchProposal", summary: "Confirm this exact reviewed public payload once through the existing door", tags: ["watch"], params: watchProposalParam, body: { name: "WatchReviewSendBody", schema: watchReviewSendBody }, reply: { name: "WatchReplyResult", schema: watchReplyResultDto }, status: [200, 202], errors: [400, 403, 404, 409, 503] },
  { method: "post", path: proposal + "/reconcile", operationId: "reconcileWatchProposal", summary: "Reconcile a stored provider receipt without sending or retrying", tags: ["watch"], params: watchProposalParam, body: { name: "WatchReviewReconcileBody", schema: watchReviewReconcileBody }, reply: { name: "WatchReplyResult", schema: watchReplyResultDto }, errors: [400, 403, 404, 409, 503] },
];
