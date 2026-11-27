import { z } from "zod";
import { watchActionQuery, watchProposalDto } from "../watch-actions";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const watchReviewListQuery = watchActionQuery;

/** Eligibility is projected by the server. Persisted sending is unresolved after a reload, never proof of a live worker. */
export const watchReviewState = z.enum(["ready", "held", "stale", "unresolved", "sent", "failed"]);
export const watchReviewDto = z.strictObject({
  proposal: watchProposalDto,
  state: watchReviewState,
  reasons: z.array(z.string()),
  observedAt: z.iso.datetime(),
  currentPolicyGeneration: z.string().nullable(),
  canPrepare: z.boolean(),
  canReconcile: z.boolean(),
  sourceLink: z.url(),
  receiptLink: z.url().nullable(),
});
export const watchReviewListDto = z.strictObject({
  project: z.string(),
  direction: z.string(),
  group: z.string(),
  messageId: z.number().int().positive(),
  observedAt: z.iso.datetime(),
  items: z.array(watchReviewDto).max(20),
});
export const watchReviewPrepareBody = z.strictObject({ payloadHash: hash });
export const watchReviewSendBody = z.strictObject({
  ticket: z.string().min(1).max(256),
  payloadHash: hash,
  policyGeneration: hash,
});
/** The browser can check only an already recorded provider id; arbitrary observed ids remain the supported CLI's job. */
export const watchReviewReconcileBody = z.strictObject({});
export const watchReviewPreparedDto = z.strictObject({
  review: watchReviewDto,
  ticket: z.string().min(1),
  expiresAt: z.iso.datetime(),
  payloadHash: hash,
  policyGeneration: hash,
});
export type WatchReviewDto = z.infer<typeof watchReviewDto>;
export type WatchReviewListDto = z.infer<typeof watchReviewListDto>;
export type WatchReviewPreparedDto = z.infer<typeof watchReviewPreparedDto>;
export type WatchReviewSendBody = z.infer<typeof watchReviewSendBody>;
