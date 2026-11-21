import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { write } from "../tx";
import { clients, drafts, inboundMail, inboxRows, mailVersions, marks, sendLog } from "../schema";
import { bareRef } from "./mail-versions";

// The Mail reader's rows (P96 S1, migration 0031). The server reads INBOX read-only and keeps one row per message it judged
// a client's; this repo stores them and answers the Inbox view. A row is "open" while no draft of that client was recorded
// after it, no agent record of that client came after it, and the owner did not press No reply needed. Reading in Mail does
// not close it: reading is not answering. Never the body: `preview` is at most 120 characters (decision 0013).

export type InboundRow = typeof inboundMail.$inferSelect;
export type InboundWhy = InboundRow["why"];
/** One open row as the Inbox view lists it: the client's newest open message, and how many open messages the client has. */
export type InboundItem = InboundRow & { messages: number };

export interface NewInbound {
  project: string;
  account: string;
  mailbox: string;
  messageId: string;
  email: string;
  name: string;
  subject: string;
  receivedAt: string;
  read: boolean;
  why: InboundWhy;
  threadDraftId?: number | null;
  threadRef?: string | null;
  preview: string;
}

/** What the reader judges a message against, per project: our own Message-IDs (and the draft each belongs to), the known clients, and who must never be listed. */
export interface InboundKnown {
  /** Every Message-ID of ours, bare: the messages our drafts answer, the Mail versions the Hub wrote, and what was sent. */
  ours: Map<string, number | null>;
  /** The project's clients (a `clients` row: a draft was recorded for them, or a chat linked). */
  clients: Set<string>;
  /** Clients marked Do not contact. */
  doNotContact: Set<string>;
}

export const PREVIEW_CHARS = 120;

/** An open row: no draft of the client recorded after it, no agent record of the client after it, not dismissed. Literal table names (rule 15). */
export const OPEN_INBOUND = `inbound_mail.dismissed_at is null
  and not exists (select 1 from drafts d join clients c on c.id = d.client_id where c.project = inbound_mail.project and c.email = inbound_mail.email and d.created_at > inbound_mail.received_at)
  and not exists (select 1 from inbox_rows r where r.project = inbound_mail.project and r.email = inbound_mail.email and r.recorded_at > inbound_mail.received_at)`;
const SQL_OPEN = sql.raw(OPEN_INBOUND);

export function inboundMailRepo(db: Db) {
  return {
    /** The facts the reader judges against. Reads SQLite only. */
    async known(project: string): Promise<InboundKnown> {
      const ours = new Map<string, number | null>();
      const put = (id: string | null | undefined, draftId: number | null) => {
        const k = bareRef(id);
        if (k && (!ours.has(k) || ours.get(k) === null)) ours.set(k, draftId);
      };
      for (const r of db.select({ ref: drafts.mailRef, sent: drafts.sentMessageId, id: drafts.id }).from(drafts).where(eq(drafts.project, project)).all()) {
        put(r.ref, r.id);
        put(r.sent, r.id);
      }
      for (const r of db.select({ ref: mailVersions.messageId, mailRef: mailVersions.mailRef, id: mailVersions.draftId }).from(mailVersions).where(eq(mailVersions.project, project)).all()) {
        put(r.ref, r.id);
        put(r.mailRef, r.id);
      }
      for (const r of db.select({ ref: sendLog.sentMessageId, mailRef: sendLog.mailRef, id: sendLog.draftId }).from(sendLog).where(and(eq(sendLog.project, project), eq(sendLog.channel, "mail"))).all()) {
        put(r.ref, r.id);
        put(r.mailRef, r.id);
      }
      for (const r of db.select({ ref: inboxRows.mailRef }).from(inboxRows).where(eq(inboxRows.project, project)).all()) put(r.ref, null);
      const known = db.select({ email: clients.email }).from(clients).where(eq(clients.project, project)).all();
      const dnc = db.select({ email: clients.email }).from(marks).innerJoin(clients, eq(clients.id, marks.clientId)).where(and(eq(marks.project, project), eq(marks.mark, "do_not_contact"))).all();
      return { ours, clients: new Set(known.map((r) => r.email.trim().toLowerCase())), doNotContact: new Set(dnc.map((r) => r.email.trim().toLowerCase())) };
    },

    /** Which of these Message-IDs are stored for the project already (the reader reads no text for them again). */
    async storedIds(project: string, ids: readonly string[]): Promise<Set<string>> {
      const want = [...new Set(ids.map(bareRef).filter(Boolean))];
      if (!want.length) return new Set();
      const rows = db.select({ id: inboundMail.messageId }).from(inboundMail).where(and(eq(inboundMail.project, project), inArray(inboundMail.messageId, want))).all();
      return new Set(rows.map((r) => r.id));
    },

    /** Stores new rows; a known row gets only its read flag. Returns how many rows were new. */
    async store(rows: readonly NewInbound[], now: Date = new Date()): Promise<number> {
      if (!rows.length) return 0;
      return write(db, (tx) => {
        let added = 0;
        for (const r of rows) {
          const messageId = bareRef(r.messageId);
          if (!messageId) continue;
          const found = tx.select({ id: inboundMail.id, read: inboundMail.read }).from(inboundMail).where(and(eq(inboundMail.project, r.project), eq(inboundMail.messageId, messageId))).get();
          if (found) {
            if (found.read !== r.read) tx.update(inboundMail).set({ read: r.read }).where(eq(inboundMail.id, found.id)).run();
            continue;
          }
          tx.insert(inboundMail)
            .values({
              project: r.project,
              account: r.account,
              mailbox: r.mailbox,
              messageId,
              email: r.email.trim().toLowerCase(),
              name: r.name.trim() || r.email.trim().toLowerCase(),
              subject: r.subject,
              receivedAt: r.receivedAt,
              read: r.read,
              why: r.why,
              threadDraftId: r.threadDraftId ?? null,
              threadRef: r.threadRef ? bareRef(r.threadRef) : null,
              preview: r.preview.slice(0, PREVIEW_CHARS),
              storedAt: now.toISOString(),
            })
            .run();
          added++;
        }
        return added;
      });
    },

    /** The Inbox view: one row per client (their newest open message), the newest first. */
    async open(project: string, opts: { limit?: number } = {}): Promise<InboundItem[]> {
      const rows = db.select().from(inboundMail).where(and(eq(inboundMail.project, project), SQL_OPEN)).orderBy(sql`${inboundMail.receivedAt} desc`, sql`${inboundMail.id} desc`).all();
      const byClient = new Map<string, InboundItem>();
      for (const r of rows) {
        const seen = byClient.get(r.email);
        if (seen) seen.messages++;
        else byClient.set(r.email, { ...r, messages: 1 });
      }
      const out = [...byClient.values()];
      return opts.limit === undefined ? out : out.slice(0, opts.limit);
    },

    /** The clients with an open message: what "N clients wrote" counts, and half of `owed` (verdict 5). */
    async openEmails(project: string): Promise<string[]> {
      return db.selectDistinct({ email: inboundMail.email }).from(inboundMail).where(and(eq(inboundMail.project, project), SQL_OPEN)).all().map((r) => r.email);
    },

    async get(project: string, id: number): Promise<(InboundRow & { open: boolean }) | null> {
      const r = db
        .select({ row: inboundMail, open: sql<number>`(case when ${SQL_OPEN} then 1 else 0 end)` })
        .from(inboundMail)
        .where(and(eq(inboundMail.project, project), eq(inboundMail.id, id)))
        .get();
      return r ? { ...r.row, open: r.open === 1 } : null;
    },

    /** The client's other open messages, newest first (the card names them). */
    async openOf(project: string, email: string): Promise<InboundRow[]> {
      return db.select().from(inboundMail).where(and(eq(inboundMail.project, project), eq(inboundMail.email, email.trim().toLowerCase()), SQL_OPEN)).orderBy(sql`${inboundMail.receivedAt} desc`).all();
    },

    /**
     * No reply needed (verdict 4): every open message of that client leaves the Inbox, stored with the moment; `undismiss`
     * (Undo) clears exactly the rows this press set. Returns the ids it changed.
     */
    async dismiss(project: string, id: number, now: Date = new Date()): Promise<number[]> {
      return write(db, (tx) => {
        const row = tx.select({ email: inboundMail.email }).from(inboundMail).where(and(eq(inboundMail.project, project), eq(inboundMail.id, id))).get();
        if (!row) return [];
        const ids = tx.select({ id: inboundMail.id }).from(inboundMail).where(and(eq(inboundMail.project, project), eq(inboundMail.email, row.email), SQL_OPEN)).all().map((r) => r.id);
        if (ids.length) tx.update(inboundMail).set({ dismissedAt: now.toISOString() }).where(inArray(inboundMail.id, ids)).run();
        return ids;
      });
    },

    /**
     * P97 S1: the open rows whose sender `isNotice` names leave Inbox with `reason` (the reader re-judges what it stored before the
     * sender was known as a lead notice). Never deletes; Undo of No reply needed does not bring them back. Returns the ids it changed.
     */
    async dismissWhere(project: string, isNotice: (email: string) => boolean, reason: "lead_notice", now: Date = new Date()): Promise<number[]> {
      const open = db.selectDistinct({ email: inboundMail.email }).from(inboundMail).where(and(eq(inboundMail.project, project), SQL_OPEN)).all().map((r) => r.email);
      const hit = open.filter(isNotice);
      if (!hit.length) return [];
      return write(db, (tx) => {
        const ids = tx.select({ id: inboundMail.id }).from(inboundMail).where(and(eq(inboundMail.project, project), inArray(inboundMail.email, hit), sql`${inboundMail.dismissedAt} is null`)).all().map((r) => r.id);
        if (ids.length) tx.update(inboundMail).set({ dismissedAt: now.toISOString(), dismissedReason: reason }).where(inArray(inboundMail.id, ids)).run();
        return ids;
      });
    },

    async undismiss(project: string, ids: readonly number[]): Promise<number> {
      if (!ids.length) return 0;
      return write(db, (tx) => tx.update(inboundMail).set({ dismissedAt: null }).where(and(eq(inboundMail.project, project), inArray(inboundMail.id, [...ids]))).run().changes);
    },
  };
}
