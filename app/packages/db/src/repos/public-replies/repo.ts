import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../client";
import { RepoError } from "../../errors";
import { sendLog, watchPublicProposals } from "../../schema";
import { write, type WriteTx } from "../../tx";
import type { NewMessengerSend, NewPublicReplySend, NewPublicReplyProposal, PublicReplyProposalRow, SendRow } from "../sends";

/** Immutable public proposals and their atomic claim. The injected audit is the same Stop/cap/spacing writer as private sends. */
export function publicRepliesRepo(db: Db, audit: (tx: WriteTx, input: NewPublicReplySend) => SendRow) {
  return {
    /** The proposal is immutable. Repeating the identical proposal id reads the first stored random_id. */
    async createPublicProposal(input: NewPublicReplyProposal): Promise<PublicReplyProposalRow> {
      return write(db, (tx) => {
        const found = tx.select().from(watchPublicProposals).where(eq(watchPublicProposals.id, input.id)).get();
        if (found) return found;
        return tx.insert(watchPublicProposals).values(input).returning().get();
      });
    },

    async publicProposal(project: string, id: string): Promise<PublicReplyProposalRow | null> {
      return db.select().from(watchPublicProposals).where(and(eq(watchPublicProposals.project, project), eq(watchPublicProposals.id, id))).get() ?? null;
    },

    async publicAttempt(proposalId: string): Promise<SendRow | null> {
      return db.select().from(sendLog).where(eq(sendLog.publicProposalId, proposalId)).get() ?? null;
    },

    /** Same transaction and account guards as private replies; a stable target cannot race across projects or directions. */
    async beginPublicReply(input: { project: string; proposalId: string; textHash: string; policyGeneration: string; at: string; limits: NewMessengerSend["limits"] }): Promise<SendRow> {
      return write(db, (tx) => {
        const p = tx.select().from(watchPublicProposals).where(and(eq(watchPublicProposals.project, input.project), eq(watchPublicProposals.id, input.proposalId))).get();
        if (!p || p.textHash !== input.textHash || p.policyGeneration !== input.policyGeneration) throw new RepoError("wrong_state", "the reviewed public proposal changed");
        if (p.expiresAt <= input.at) throw new RepoError("wrong_state", "the reviewed public proposal expired");
        if (tx.select({ id: sendLog.id }).from(sendLog).where(eq(sendLog.publicProposalId, p.id)).get()) throw new RepoError("wrong_state", "this public proposal already has an attempt; do not retry it");
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
