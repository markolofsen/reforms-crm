import { getLeadPass, getLeadReview, redoLead, runLeadPass } from "@hub/api";
import { leadPassDto, leadRedoneDto, leadReviewDto, runLeadPassDto } from "@hub/contract/lead-pass";
import { readGenerated } from "../client";

/**
 * The daily lead pass of one project (P147 L6, decision 0055): today's decisions, the last and next pass, the review's batch; Run
 * lead pass now; Redo of one lead's decision; the review read (each draft's full text from Mail). Nothing here sends: the review's
 * one click is the send door's (`leadReviewApi` in `lib/api/send.ts`).
 */
export type ReviewRead = { only?: readonly number[] | undefined; stored?: boolean | undefined };

export const leadPassApi = {
  get: (project: string) => readGenerated(getLeadPass(project), leadPassDto),
  /** The server answers 202: the pass runs in the background (or the click joins the one running). */
  run: (project: string, pass?: "lead" | "mail") => readGenerated(runLeadPass(project, pass ? { pass } : {}), runLeadPassDto, [202]),
  redo: (project: string, pageId: string) => readGenerated(redoLead(project, pageId), leadRedoneDto),
  /** `only`: just these drafts (a selection); `stored`: the Hub's own copy at once, no Mail read (the sheet's first paint). */
  review: (project: string, batchId: number, q: ReviewRead = {}) => readGenerated(getLeadReview(project, batchId, { ...(q.only?.length ? { only: q.only.join(",") } : {}), ...(q.stored ? { stored: "1" as const } : {}) }), leadReviewDto),
};
