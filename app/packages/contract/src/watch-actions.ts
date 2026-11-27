import { z } from "zod";
import { watchPhotoAsset } from "./watch/media";
import { SLUG } from "./refs";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const slug = z.string().regex(SLUG).max(100);
const direction = z.string().regex(/^[a-z][a-z0-9_-]*$/).max(64);
const group = z.string().regex(/^[a-z][a-z0-9_]{3,31}$/);
export const watchActionParam = z.object({ slug });
export const watchProposalParam = z.object({ slug, id: hash });
export const watchActionQuery = z.object({ direction, group, messageId: z.coerce.number().int().positive() });
export const watchProposalBody = z.strictObject({
  direction, group, messageId: z.number().int().positive(), text: z.string().min(1).max(4096),
  sourceHash: hash, rulesHash: hash, photo: watchPhotoAsset.optional(),
  review: z.strictObject({ ref: z.string().min(1).max(1000), at: z.iso.datetime(), rulesAccepted: z.literal(true) }),
});
export const watchReplyBody = z.union([z.strictObject({ textHash: hash }), z.strictObject({ payloadHash: hash })]);
export const watchReconcileBody = z.strictObject({ messageId: z.number().int().positive().optional() });

const source = z.object({
  id: z.number().int().positive(), at: z.iso.datetime(), text: z.string(), replyToMessageId: z.number().int().nullable(),
  threadId: z.number().int().nullable(), outgoing: z.boolean(), service: z.boolean(),
});
export const watchReplyContextDto = z.object({
  account: z.string(), direction, group, capturedAt: z.iso.datetime(),
  policyGeneration: z.string(), policyRevision: z.number().int(), strategyHash: hash,
  sourceHash: hash, rulesHash: hash,
  snapshot: z.object({
    chatId: z.number().int(), username: z.string().nullable(), kind: z.enum(["group", "channel"]),
    isMember: z.boolean(), canSendText: z.boolean(), canSendPhotos: z.boolean().optional(), refusal: z.string().nullable(), slowmodeUntil: z.string().nullable(),
    source: source.nullable(),
    rules: z.object({ description: z.string(), pinned: z.object({ id: z.number().int(), text: z.string() }).nullable(), latestPinOnly: z.literal(true) }),
  }),
});
export const watchProposalDto = z.object({
  id: hash, project: slug, direction, account: z.string(), groupUsername: group, chatId: z.number().int(),
  replyToMessageId: z.number().int().positive(), threadId: z.number().int().nullable(), text: z.string(), textHash: hash,
  payloadHash: hash, photo: watchPhotoAsset.nullable(),
  sourceHash: hash, sourceAt: z.iso.datetime(), rulesHash: hash, policyGeneration: z.string(), policyRevision: z.number().int(),
  strategyHash: hash, reviewRef: z.string(), reviewedAt: z.iso.datetime(), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  attempt: z.object({ id: z.number().int(), status: z.string(), messageId: z.string().nullable(), reason: z.string().nullable() }).nullable(),
});
export const watchReplyResultDto = z.union([
  z.object({ refused: z.array(z.string()).min(1) }),
  z.object({ status: z.enum(["sent", "failed", "uncertain"]), proposalId: hash, sendId: z.number().int(), messageId: z.string().nullable(), reason: z.string().nullable() }),
]);
export type WatchProposalInput = z.infer<typeof watchProposalBody>;
