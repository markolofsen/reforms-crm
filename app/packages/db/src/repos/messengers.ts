import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { messengerCacheRepo } from "./messenger-cache";
import { messengerChatsRepo } from "./messenger-chats";
import { messengerProjectionRepo } from "./messenger-projection";
import { messengerTriageRepo } from "./messenger-triage";
import {
  clientIdentifiers,
  clients,
  messengerAccounts,
  messengerChats,
  messengerDrafts,
  messengerLinkRefusals,
  messengerMessages,
  type IdentifierKind,
  type MessengerChannel,
} from "../schema";

export type MessengerMessageRow = typeof messengerMessages.$inferSelect;
export type NewMessengerMessage = Omit<typeof messengerMessages.$inferInsert, "id" | "createdAt">;
export type MessengerDraftRow = typeof messengerDrafts.$inferSelect;
export type NewMessengerDraft = {
  project: string;
  channel: MessengerChannel;
  chatId: string;
  text: string;
  createdBy: string;
  clientId?: number | null;
  /** The owner's words that admitted it in an `on_request` chat (P71 M2b). */
  ownerRequest?: string | null;
  /** A follow-up after our own last message (P71 M2b). */
  nudge?: boolean;
};
export type ClientIdentifierRow = typeof clientIdentifiers.$inferSelect;
export type MessengerAccountRow = typeof messengerAccounts.$inferSelect;
export type ChatRef = { channel: MessengerChannel; chatId: string };

const now = () => new Date().toISOString();

/** Messengers: allow-list, stored messages, polling state, client identifiers, outbound drafts. Every query filters by `project`. */
export function messengersRepo(db: Db) {
  const requireClient = (project: string, clientId: number) => {
    const row = db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.project, project)))
      .get();
    if (!row) throw new RepoError("not_found", `not_found: client ${clientId} is not in project "${project}"`);
  };

  const draftTransition = (id: number, project: string, from: string, set: Partial<typeof messengerDrafts.$inferInsert>) => {
    const row = db
      .update(messengerDrafts)
      .set({ ...set, updatedAt: now() })
      .where(and(eq(messengerDrafts.id, id), eq(messengerDrafts.project, project), eq(messengerDrafts.status, from as never)))
      .returning()
      .get();
    if (row) return row;
    const cur = db.select().from(messengerDrafts).where(and(eq(messengerDrafts.id, id), eq(messengerDrafts.project, project))).get();
    if (!cur) throw new RepoError("not_found", `not_found: draft ${id}`);
    throw new RepoError("wrong_state", `wrong_state: draft ${id} is "${cur.status}", expected "${from}"`);
  };

  const chats = messengerChatsRepo(db);
  const projection = messengerProjectionRepo(db);

  return {
    ...chats,
    ...projection,
    // ---- the link and the message cache (decision 0049, P141)
    ...messengerCacheRepo(db),
    // ---- the pre-analysis' verdicts (P71 M-P)
    ...messengerTriageRepo(db),
    // ---- allow-list
    /**
     * P131 O5: the chat's own Telegram username (stored without `@`) and phone (digits only), on a linked chat only. A null or empty
     * value leaves what is stored: a later scan that does not see the phone never erases it. Returns whether a row changed.
     */
    async setChatIdentity(project: string, channel: MessengerChannel, chatId: string, id: { username?: string | null; phone?: string | null }): Promise<boolean> {
      const username = id.username?.trim().replace(/^@/, "") || null;
      const digits = id.phone?.replace(/\D/g, "") || null;
      const set = { ...(username ? { username } : {}), ...(digits && digits.length >= 7 ? { phone: digits } : {}) };
      if (!Object.keys(set).length) return false;
      return db.update(messengerChats).set(set).where(and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId))).run().changes > 0;
    },
    /** Takes the chat off the allow-list with its stored messages and drafts, in one transaction (`unlinkChat`). Returns whether it was listed. */
    async disallowChat(project: string, channel: MessengerChannel, chatId: string): Promise<boolean> {
      return (await chats.unlinkChat(project, channel, chatId)).removed;
    },
    // ---- "never link this chat" (P84): hashes only, made by the server's autolink from a key under state/secrets
    async refuseLink(project: string, channel: MessengerChannel, hash: string): Promise<void> {
      db.insert(messengerLinkRefusals).values({ project, channel, hash }).onConflictDoNothing().run();
    },
    /** Unhide (P84c): the owner takes a "not a client" back; the autolink may consider the chat again. Returns whether a row went. */
    async forgetLinkRefusal(project: string, channel: MessengerChannel, hash: string): Promise<boolean> {
      const r = db.delete(messengerLinkRefusals).where(and(eq(messengerLinkRefusals.project, project), eq(messengerLinkRefusals.channel, channel), eq(messengerLinkRefusals.hash, hash))).run();
      return r.changes > 0;
    },
    async linkRefusals(project: string): Promise<{ channel: MessengerChannel; hash: string }[]> {
      return db.select({ channel: messengerLinkRefusals.channel, hash: messengerLinkRefusals.hash }).from(messengerLinkRefusals).where(eq(messengerLinkRefusals.project, project)).all();
    },
    async isAllowed(project: string, channel: MessengerChannel, chatId: string): Promise<boolean> {
      return !!db
        .select({ id: messengerChats.id })
        .from(messengerChats)
        .where(and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId)))
        .get();
    },
    async allowedChats(project: string) {
      return db.select().from(messengerChats).where(eq(messengerChats.project, project)).orderBy(asc(messengerChats.id)).all();
    },

    // ---- messages
    /** Idempotent on (project, channel, chat, remote id): returns false for a repeat. */
    async insertMessage(m: NewMessengerMessage): Promise<boolean> {
      return db.insert(messengerMessages).values(m).onConflictDoNothing().run().changes > 0;
    },

    /**
     * Messages of the given chats strictly older than `before` (all when unset), plus every message sent exactly at
     * `before`, newest first. The tie rows let a merged cursor split a timestamp exactly. `limit` bounds the strictly
     * older part.
     */
    async messagesOf(project: string, chats: ChatRef[], opts: { before?: string; limit: number }): Promise<MessengerMessageRow[]> {
      if (chats.length === 0) return [];
      const inChats = or(...chats.map((c) => and(eq(messengerMessages.channel, c.channel), eq(messengerMessages.chatId, c.chatId))));
      const base = and(eq(messengerMessages.project, project), inChats);
      const order = [desc(messengerMessages.sentAt), desc(messengerMessages.id)] as const;
      if (!opts.before) return db.select().from(messengerMessages).where(base).orderBy(...order).limit(opts.limit).all();
      const older = db
        .select()
        .from(messengerMessages)
        .where(and(base, lt(messengerMessages.sentAt, opts.before)))
        .orderBy(...order)
        .limit(opts.limit)
        .all();
      const ties = db
        .select()
        .from(messengerMessages)
        .where(and(base, eq(messengerMessages.sentAt, opts.before)))
        .orderBy(...order)
        .all();
      return [...ties, ...older];
    },

    /** Retention purge: deletes rows whose `retain_until` has passed. Returns the count. */
    async purgeExpired(at: string = now()): Promise<number> {
      return db.delete(messengerMessages).where(lt(messengerMessages.retainUntil, at)).run().changes;
    },

    async messageCounts(project: string): Promise<{ channel: MessengerChannel; n: number; newest: string | null }[]> {
      return db
        .select({ channel: messengerMessages.channel, n: sql<number>`count(*)`, newest: sql<string | null>`max(${messengerMessages.sentAt})` })
        .from(messengerMessages)
        .where(eq(messengerMessages.project, project))
        .groupBy(messengerMessages.channel)
        .all();
    },

    // ---- polling state
    async account(project: string, channel: MessengerChannel, account: string): Promise<MessengerAccountRow | null> {
      return (
        db
          .select()
          .from(messengerAccounts)
          .where(and(eq(messengerAccounts.project, project), eq(messengerAccounts.channel, channel), eq(messengerAccounts.account, account)))
          .get() ?? null
      );
    },
    async accounts(project: string): Promise<MessengerAccountRow[]> {
      return db.select().from(messengerAccounts).where(eq(messengerAccounts.project, project)).orderBy(asc(messengerAccounts.id)).all();
    },
    /** Stores the poll position (after the batch it covers is stored) and clears the last error. */
    async markPollOk(project: string, channel: MessengerChannel, account: string, cursor: string | null, at: string = now()): Promise<void> {
      db.insert(messengerAccounts)
        .values({ project, channel, account, cursor, lastOkAt: at, updatedAt: at })
        .onConflictDoUpdate({
          target: [messengerAccounts.project, messengerAccounts.channel, messengerAccounts.account],
          set: { cursor, lastOkAt: at, lastError: null, lastErrorAt: null, updatedAt: at },
        })
        .run();
    },
    async markPollError(project: string, channel: MessengerChannel, account: string, error: string, at: string = now()): Promise<void> {
      db.insert(messengerAccounts)
        .values({ project, channel, account, lastError: error, lastErrorAt: at, updatedAt: at })
        .onConflictDoUpdate({
          target: [messengerAccounts.project, messengerAccounts.channel, messengerAccounts.account],
          set: { lastError: error, lastErrorAt: at, updatedAt: at },
        })
        .run();
    },

    // ---- client identifiers
    /** `duplicate_identifier` when the value already belongs to a client of this project (this one or another). */
    async addIdentifier(project: string, clientId: number, kind: IdentifierKind, value: string): Promise<number> {
      requireClient(project, clientId);
      try {
        return db.insert(clientIdentifiers).values({ project, clientId, kind, value }).returning({ id: clientIdentifiers.id }).get().id;
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed: client_identifiers/.test(err.message)) {
          throw new RepoError("duplicate_identifier", `duplicate_identifier: ${kind} "${value}" is already linked in "${project}"`);
        }
        throw err;
      }
    },
    async removeIdentifier(project: string, kind: IdentifierKind, value: string): Promise<ClientIdentifierRow | null> {
      return (
        db
          .delete(clientIdentifiers)
          .where(and(eq(clientIdentifiers.project, project), eq(clientIdentifiers.kind, kind), eq(clientIdentifiers.value, value)))
          .returning()
          .get() ?? null
      );
    },
    /**
     * P102 Change client: the identifier moves to another client of the project, in one UPDATE (the chat's stored messages are keyed
     * by chat, so they stay). Returns the client it left, or null when no such identifier exists.
     */
    async moveIdentifier(project: string, kind: IdentifierKind, value: string, toClientId: number): Promise<number | null> {
      requireClient(project, toClientId);
      const was = db
        .select({ clientId: clientIdentifiers.clientId })
        .from(clientIdentifiers)
        .where(and(eq(clientIdentifiers.project, project), eq(clientIdentifiers.kind, kind), eq(clientIdentifiers.value, value)))
        .get();
      if (!was) return null;
      db.update(clientIdentifiers)
        .set({ clientId: toClientId })
        .where(and(eq(clientIdentifiers.project, project), eq(clientIdentifiers.kind, kind), eq(clientIdentifiers.value, value)))
        .run();
      return was.clientId;
    },
    async identifiersOf(project: string, clientId: number): Promise<ClientIdentifierRow[]> {
      requireClient(project, clientId);
      return db
        .select()
        .from(clientIdentifiers)
        .where(and(eq(clientIdentifiers.project, project), eq(clientIdentifiers.clientId, clientId)))
        .orderBy(asc(clientIdentifiers.id))
        .all();
    },
    async clientByIdentifier(project: string, kind: IdentifierKind, value: string): Promise<number | null> {
      return (
        db
          .select({ clientId: clientIdentifiers.clientId })
          .from(clientIdentifiers)
          .where(and(eq(clientIdentifiers.project, project), eq(clientIdentifiers.kind, kind), eq(clientIdentifiers.value, value)))
          .get()?.clientId ?? null
      );
    },

    // ---- outbound drafts (state machine: draft -> confirmed -> sent; draft -> copied | discarded; discarded -> draft, the Undo of Skip)
    /** Always creates status `draft`: no argument can set another state. */
    async createDraft(input: NewMessengerDraft): Promise<MessengerDraftRow> {
      if (input.clientId != null) requireClient(input.project, input.clientId);
      return db
        .insert(messengerDrafts)
        .values({ project: input.project, channel: input.channel, chatId: input.chatId, text: input.text, createdBy: input.createdBy, clientId: input.clientId ?? null, ownerRequest: input.ownerRequest ?? null, nudge: input.nudge ?? false })
        .returning()
        .get();
    },
    async getDraft(project: string, id: number): Promise<MessengerDraftRow | null> {
      return db.select().from(messengerDrafts).where(and(eq(messengerDrafts.project, project), eq(messengerDrafts.id, id))).get() ?? null;
    },
    async listDrafts(project: string, status?: MessengerDraftRow["status"][]): Promise<MessengerDraftRow[]> {
      const where = status?.length
        ? and(eq(messengerDrafts.project, project), inArray(messengerDrafts.status, status))
        : eq(messengerDrafts.project, project);
      return db.select().from(messengerDrafts).where(where).orderBy(asc(messengerDrafts.id)).all();
    },
    async confirmDraft(project: string, id: number, by: string, at: string = now()): Promise<MessengerDraftRow> {
      return draftTransition(id, project, "draft", { status: "confirmed", confirmedBy: by, confirmedAt: at });
    },
    async markDraftSent(project: string, id: number, remoteMessageId: string, at: string = now()): Promise<MessengerDraftRow> {
      return draftTransition(id, project, "confirmed", { status: "sent", sentAt: at, remoteMessageId });
    },
    async markDraftCopied(project: string, id: number, by: string, at: string = now()): Promise<MessengerDraftRow> {
      return draftTransition(id, project, "draft", { status: "copied", confirmedBy: by, confirmedAt: at });
    },
    async discardDraft(project: string, id: number): Promise<MessengerDraftRow> {
      return draftTransition(id, project, "draft", { status: "discarded" });
    },
    /** Undo of Skip on the Messengers panel (P71 M3, `ui-specifications.md` rule 5d): a skipped draft waits again. */
    async restoreDraft(project: string, id: number): Promise<MessengerDraftRow> {
      return draftTransition(id, project, "discarded", { status: "draft" });
    },
    /**
     * A send that failed after the approval (P71 M4): the draft waits again, so the owner may press Send once more. The hub never
     * retries by itself; the failed attempt stays in `send_log`.
     */
    async unconfirmDraft(project: string, id: number): Promise<MessengerDraftRow> {
      return draftTransition(id, project, "confirmed", { status: "draft", confirmedBy: null, confirmedAt: null });
    },
  };
}
