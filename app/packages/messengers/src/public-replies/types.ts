import type { PublicPhotoAsset } from "@hub/contract/watch-media";
import type { PublicReplyProposalRow, Repos, SendRow } from "@hub/db";
import type { PublicPhotoAssets } from "./assets";
import type { PublicReplyError, PublicReplySender } from "../public-reply";
import type { MtPublicTarget } from "../telegram-user";

export const PUBLIC_SOURCE_MAX_AGE_MS = 48 * 3_600_000;
export const PUBLIC_REVIEW_MAX_AGE_MS = 30 * 60_000;
export type PublicReplyScope = { direction: string; groupUsername: string; account: string; chatId: number };

/** Composition combines the protected Watch grant with the same project lifecycle/recipient policy. */
export interface PublicReplyPolicy {
  refusal: string | null;
  generation: string;
  revision: number;
  requestRef: string;
  strategyHash: string;
  repliesPerDay: number;
  photoReplies?: boolean;
}
export interface PublicReplyDoorDeps {
  repos: Repos;
  policy(project: string, scope: PublicReplyScope): PublicReplyPolicy;
  sender(account: string): PublicReplySender | undefined;
  assets?: Pick<PublicPhotoAssets, "read">;
  failed?(account: string, error: PublicReplyError): Promise<void>;
  now?: () => Date;
}
export interface ReviewedPublicReply {
  project: string;
  direction: string;
  groupUsername: string;
  account: string;
  target: MtPublicTarget;
  messageId: number;
  text: string;
  photo?: PublicPhotoAsset;
  sourceHash: string;
  rulesHash: string;
  reviewRef: string;
  reviewedAt: string;
}
export type PublicReplyRefused = { refused: string[] };
export type PublicReplyApply = PublicReplyRefused |
  { status: "sent" | "failed" | "uncertain"; proposalId: string; sendId: number; messageId: string | null; reason: string | null };
export interface PublicReplyAssessment {
  proposal: PublicReplyProposalRow;
  policy: PublicReplyPolicy;
  reasons: string[];
  attempt: SendRow | null;
  state: "ready" | "held" | "stale" | "sent" | "uncertain" | "failed";
}
export const publicReplyNow = (deps: PublicReplyDoorDeps): Date => (deps.now ?? (() => new Date()))();
export const publicReplyTarget = (p: PublicReplyProposalRow): MtPublicTarget => ({ id: p.chatId, accessHash: p.accessHash });
export const publicReplyScope = (p: PublicReplyProposalRow): PublicReplyScope => ({ direction: p.direction, groupUsername: p.groupUsername, account: p.account, chatId: p.chatId });
