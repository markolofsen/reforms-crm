import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../client";
import { write, type WriteTx } from "../tx";
import { bugFixedNotes, drafts, type BugNoteChannel } from "../schema";

// P145 B4 (P147 3m item 6, migration 0050): the notes of fixed bugs. The sweep claims a (report, client) before its turn, the
// turn's draft is stamped on the claim in the draft's own transaction, the send sets `told_at`, and Notion's `Client told` is
// written once every claimed client of the report was told. A turn that wrote no draft releases its claim (tomorrow retries).

export type BugNoteRow = typeof bugFixedNotes.$inferSelect;

/** The note's draft, in the draft record's transaction (a turn that dies after its draft still has its note stamped). */
export function stampBugNoteDraft(tx: WriteTx, o: { noteId: number; draftId?: number; messengerDraftId?: number; at: string }): void {
  tx.update(bugFixedNotes)
    .set({ ...(o.draftId !== undefined ? { draftId: o.draftId } : {}), ...(o.messengerDraftId !== undefined ? { messengerDraftId: o.messengerDraftId } : {}), draftedAt: o.at })
    .where(eq(bugFixedNotes.id, o.noteId))
    .run();
}

export function bugNotesRepo(db: Db) {
  return {
    /** The (report, client) pairs that already have a note, of these reports: the sweep never drafts them again. */
    async known(project: string, reportPageIds: readonly string[]): Promise<Set<string>> {
      if (!reportPageIds.length) return new Set();
      const rows = db.select({ r: bugFixedNotes.reportPageId, c: bugFixedNotes.clientId }).from(bugFixedNotes).where(and(eq(bugFixedNotes.project, project), inArray(bugFixedNotes.reportPageId, [...reportPageIds]))).all();
      return new Set(rows.map((x) => `${x.r}:${x.c}`));
    },

    /** Claims one note before its turn; null when another claim won (the pair has a note). */
    async claim(o: { project: string; reportPageId: string; clientId: number; channel: BugNoteChannel }): Promise<BugNoteRow | null> {
      return db.insert(bugFixedNotes).values(o).onConflictDoNothing().returning().get() ?? null;
    },

    /** A messenger note's draft (`messenger_draft_write` in the note's turn, right after its record). */
    async stampMessenger(noteId: number, messengerDraftId: number, at: string): Promise<void> {
      db.update(bugFixedNotes).set({ messengerDraftId, draftedAt: at }).where(eq(bugFixedNotes.id, noteId)).run();
    },

    async get(id: number): Promise<BugNoteRow | null> {
      return db.select().from(bugFixedNotes).where(eq(bugFixedNotes.id, id)).get() ?? null;
    },

    /** A turn that wrote no draft gives its claim back, so the next sweep tries again. */
    async release(id: number): Promise<void> {
      db.delete(bugFixedNotes).where(and(eq(bugFixedNotes.id, id), isNull(bugFixedNotes.draftId), isNull(bugFixedNotes.messengerDraftId))).run();
    },

    /** The mail notes whose draft is in this batch (the review's "fixed" rows). */
    async ofBatch(project: string, batchId: number): Promise<BugNoteRow[]> {
      return db.select({ n: bugFixedNotes }).from(bugFixedNotes).innerJoin(drafts, eq(drafts.id, bugFixedNotes.draftId)).where(and(eq(bugFixedNotes.project, project), eq(drafts.batchId, batchId))).all().map((r) => r.n);
    },

    /** The note a sent draft carried, if any (the at-send stamp). */
    async ofDraft(draftId: number): Promise<BugNoteRow | null> {
      return db.select().from(bugFixedNotes).where(eq(bugFixedNotes.draftId, draftId)).get() ?? null;
    },
    async ofMessengerDraft(id: number): Promise<BugNoteRow | null> {
      return db.select().from(bugFixedNotes).where(eq(bugFixedNotes.messengerDraftId, id)).get() ?? null;
    },

    /** At the send: the client was told at `at`. Returns the note when this call set it. */
    async told(id: number, at: string): Promise<BugNoteRow | null> {
      return db.update(bugFixedNotes).set({ toldAt: at }).where(and(eq(bugFixedNotes.id, id), isNull(bugFixedNotes.toldAt))).returning().get() ?? null;
    },

    /** The reports whose every note was told and Notion not yet written, with the last send's time. */
    async notionDue(project: string): Promise<Array<{ reportPageId: string; toldAt: string }>> {
      return db
        .select({ reportPageId: bugFixedNotes.reportPageId, toldAt: sql<string>`max(${bugFixedNotes.toldAt})` })
        .from(bugFixedNotes)
        .where(and(eq(bugFixedNotes.project, project), isNull(bugFixedNotes.notionToldAt)))
        .groupBy(bugFixedNotes.reportPageId)
        .having(sql`count(*) = count(${bugFixedNotes.toldAt})`)
        .all();
    },

    async notionTold(project: string, reportPageId: string, at: string): Promise<number> {
      return write(db, (tx) => tx.update(bugFixedNotes).set({ notionToldAt: at }).where(and(eq(bugFixedNotes.project, project), eq(bugFixedNotes.reportPageId, reportPageId))).returning({ id: bugFixedNotes.id }).all().length);
    },
  };
}
