import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../../client";
import { RepoError } from "../../errors";
import { sendLog, watchPublicPhotos, watchPublicProposals } from "../../schema";
import { write, type WriteTx } from "../../tx";
import type { NewMessengerSend, NewPublicReplySend, NewPublicReplyProposal, PreparedPublicPhotoRow, PublicReplyProposalRow, SendRow } from "../sends";

/** Immutable public proposals and their atomic claim. The injected audit is the same Stop/cap/spacing writer as private sends. */
export function publicRepliesRepo(db: Db, audit: (tx: WriteTx, input: NewPublicReplySend) => SendRow) {
  return {
    /** The proposal is immutable. Repeating the identical proposal id reads the first stored random_id. */
    async createPublicProposal(input: NewPublicReplyProposal): Promise<PublicReplyProposalRow> {
      return write(db, (tx) => {
        const found = tx.select().from(watchPublicProposals).where(and(eq(watchPublicProposals.project, input.project), eq(watchPublicProposals.id, input.id))).get();
        if (found) return found;
        return tx.insert(watchPublicProposals).values(input).returning().get();
      });
    },

    async publicProposal(project: string, id: string): Promise<PublicReplyProposalRow | null> {
      return db.select().from(watchPublicProposals).where(and(eq(watchPublicProposals.project, project), eq(watchPublicProposals.id, id))).get() ?? null;
    },

    /** Scope every predicate before LIMIT: another source/account must never hide this source's proposals. */
    async publicProposalsForSource(input: { project: string; direction: string; groupUsername: string; account: string; chatId: number; messageId: number; limit?: number }): Promise<PublicReplyProposalRow[]> {
      const limit = Number.isFinite(input.limit) ? Math.min(20, Math.max(1, Math.floor(input.limit ?? 20))) : 20;
      return db.select().from(watchPublicProposals).where(and(eq(watchPublicProposals.project, input.project),
        eq(watchPublicProposals.direction, input.direction), eq(watchPublicProposals.groupUsername, input.groupUsername),
        eq(watchPublicProposals.account, input.account), eq(watchPublicProposals.chatId, input.chatId),
        eq(watchPublicProposals.replyToMessageId, input.messageId))).orderBy(desc(watchPublicProposals.createdAt), desc(watchPublicProposals.id)).limit(limit).all();
    },

    async publicAttempt(proposalId: string): Promise<SendRow | null> {
      return db.select().from(sendLog).where(eq(sendLog.publicProposalId, proposalId)).get() ?? null;
    },

    /** Physical target uniqueness crosses project/direction boundaries; expose only the reservation, never another project's text. */
    async publicTargetReserved(targetKey: string): Promise<boolean> {
      return !!db.select({ id: sendLog.id }).from(sendLog).where(and(eq(sendLog.publicTargetKey, targetKey), inArray(sendLog.status, ["queued", "sending", "sent"]))).get();
    },

    /** The public actor's physical-account share, just as the audit counts it. No private message data leaves this query. */
    async publicReplyUsage(account: string, at: string): Promise<number> {
      const since = new Date(Date.parse(at) - 86_400_000).toISOString();
      const row = db.select({ n: sql<number>`count(*)` }).from(sendLog).where(and(eq(sendLog.channel, "telegram_user"),
        eq(sendLog.sender, account), eq(sendLog.actor, "watch_review"), inArray(sendLog.status, ["sending", "sent"]), gte(sendLog.createdAt, since))).get();
      return Number(row?.n ?? 0);
    },

    async publicPhoto(project: string, proposalId: string): Promise<PreparedPublicPhotoRow | null> {
      return db.select().from(watchPublicPhotos).where(and(eq(watchPublicPhotos.project, project), eq(watchPublicPhotos.proposalId, proposalId))).get() ?? null;
    },

    /** Persist a provider identity before the audit. First preparation wins; it cannot be swapped after an attempt. */
    async preparePublicPhoto(input: PreparedPublicPhotoRow): Promise<PreparedPublicPhotoRow> {
      return write(db, (tx) => {
        const p = tx.select().from(watchPublicProposals).where(and(eq(watchPublicProposals.project, input.project), eq(watchPublicProposals.id, input.proposalId))).get();
        if (!p?.photo || p.photo.sha256 !== input.assetHash || p.account !== input.account) throw new RepoError("wrong_state", "the photo preparation does not match the reviewed asset/account");
        if (tx.select({ id: sendLog.id }).from(sendLog).where(eq(sendLog.publicProposalId, p.id)).get()) throw new RepoError("wrong_state", "this proposal already has an attempt; its prepared photo cannot change");
        const found = tx.select().from(watchPublicPhotos).where(and(eq(watchPublicPhotos.project, input.project), eq(watchPublicPhotos.proposalId, p.id))).get();
        if (found) {
          if (found.assetHash !== input.assetHash || found.account !== input.account) throw new RepoError("wrong_state", "the prepared photo identity changed");
          return found;
        }
        return tx.insert(watchPublicPhotos).values(input).returning().get();
      });
    },

    /** Same transaction and account guards as private replies; a stable target cannot race across projects or directions. */
    async beginPublicReply(input: { project: string; proposalId: string; textHash: string; payloadHash?: string; policyGeneration: string; at: string; limits: NewMessengerSend["limits"] }): Promise<SendRow> {
      return write(db, (tx) => {
        const p = tx.select().from(watchPublicProposals).where(and(eq(watchPublicProposals.project, input.project), eq(watchPublicProposals.id, input.proposalId))).get();
        if (!p || p.textHash !== input.textHash || (p.payloadHash ?? p.textHash) !== (input.payloadHash ?? input.textHash) || p.policyGeneration !== input.policyGeneration) throw new RepoError("wrong_state", "the reviewed public proposal changed");
        if (p.expiresAt <= input.at) throw new RepoError("wrong_state", "the reviewed public proposal expired");
        if (tx.select({ id: sendLog.id }).from(sendLog).where(eq(sendLog.publicProposalId, p.id)).get()) throw new RepoError("wrong_state", "this public proposal already has an attempt; do not retry it");
        if (p.photo) {
          const prepared = tx.select().from(watchPublicPhotos).where(and(eq(watchPublicPhotos.project, p.project), eq(watchPublicPhotos.proposalId, p.id))).get();
          if (!prepared || prepared.assetHash !== p.photo.sha256 || prepared.account !== p.account) throw new RepoError("wrong_state", "the exact reviewed photo has no persisted provider identity");
        }
        return audit(tx, { project: p.project, channel: "telegram_user", publicProposalId: p.id, publicTargetKey: p.targetKey,
          account: p.account, to: `telegram:${p.chatId}`, name: `@${p.groupUsername} reply:${p.replyToMessageId}`,
          text: p.text, actor: "watch_review", at: input.at, limits: input.limits });
      });
    },

    /** A lost response may follow delivery. Keep sending (and its target/quota reservation), never turn it into a retry. */
    async markPublicUncertain(id: number, reason: string, messageId: string | null = null): Promise<SendRow | null> {
      return write(db, (tx) => tx.update(sendLog).set({ error: reason.slice(0, 300), ...(messageId ? { sentMessageId: messageId } : {}) })
        .where(and(eq(sendLog.id, id), eq(sendLog.status, "sending"), sql`${sendLog.publicProposalId} is not null`)).returning().get() ?? null);
    },
  };
}
