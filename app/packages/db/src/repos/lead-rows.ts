import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { write } from "../tx";
import { leadRows, type LeadDismissReason } from "../schema";

// The Leads reader's rows (P97 S2, decision 0044, migration 0033). The server reads the project's Notion Leads data source with
// the hub token and keeps one row per page received in the project's window (`leads.window_days`); this repo stores them and
// answers Mail ▸ Inbox's Leads group. A row is "open" while its Status as read is New (or empty), the owner did not press Not now
// or Spam, no first send converted it, and no Hub draft to its address was recorded after it arrived. Decision 0013: nothing but
// the page id, the name, the two addresses, the brand, when, the Status and 120 characters of the Message.

export type LeadRow = typeof leadRows.$inferSelect;
/** One person of the Leads group: their newest open request, and how many open requests share the address (verdict 7). */
export type LeadItem = LeadRow & { requests: number };

export interface NewLead {
  project: string;
  pageId: string;
  name: string;
  /** The reply address (the email typed on the form, else the Leads Email); null: none (phone or Telegram only). */
  email: string | null;
  accountEmail: string | null;
  brand: string | null;
  receivedAt: string;
  preview: string;
  /** The Status as read; null: the cell is empty (handled as New). */
  notionStatus: string | null;
  hasClient: boolean;
}

export const LEAD_PREVIEW_CHARS = 120;
const norm = (id: string) => id.replace(/-/g, "").toLowerCase();
const lower = (s: string | null) => (s ? s.trim().toLowerCase() || null : null);

/**
 * An open row: Status New or empty, not dismissed, not converted, and no Hub draft to either of its addresses recorded after it
 * arrived (the draft is the work; the row comes back only if that draft is deleted). Literal table names (rule 15).
 */
export const OPEN_LEAD = `lead_rows.dismissed_at is null and lead_rows.converted_at is null
  and (lead_rows.notion_status is null or lead_rows.notion_status = 'New')
  and not exists (select 1 from drafts d join clients c on c.id = d.client_id where c.project = lead_rows.project and (c.email = lead_rows.email or c.email = lead_rows.account_email) and d.created_at > lead_rows.received_at)`;
const SQL_OPEN = sql.raw(OPEN_LEAD);

export function leadRowsRepo(db: Db) {
  const since = (s: string) => sql`${leadRows.receivedAt} >= ${s}`;
  /** The Leads group: one row per person (their newest open request), the newest first; only rows received at or after `from`. */
  async function open(project: string, from: string): Promise<LeadItem[]> {
    const rows = db.select().from(leadRows).where(and(eq(leadRows.project, project), since(from), SQL_OPEN)).orderBy(sql`${leadRows.receivedAt} desc`, sql`${leadRows.id} desc`).all();
    const byPerson = new Map<string, LeadItem>();
    for (const r of rows) {
      const key = r.email ?? r.accountEmail ?? `page:${r.pageId}`;
      const seen = byPerson.get(key);
      if (seen) seen.requests++;
      else byPerson.set(key, { ...r, requests: 1 });
    }
    return [...byPerson.values()];
  }

  return {
    /**
     * One read of the project's Leads: new pages are stored, known ones get the fields Notion holds now (a Status moved in Notion
     * closes the row; the owner's Not now, Spam and the conversion are local and kept). Returns how many rows were new.
     */
    async sync(rows: readonly NewLead[], now: Date = new Date()): Promise<number> {
      if (!rows.length) return 0;
      const at = now.toISOString();
      return write(db, (tx) => {
        let added = 0;
        for (const r of rows) {
          const pageId = norm(r.pageId);
          const fields = {
            name: r.name.trim() || "(no name)",
            email: lower(r.email),
            accountEmail: lower(r.accountEmail),
            brand: r.brand,
            receivedAt: r.receivedAt,
            preview: r.preview.slice(0, LEAD_PREVIEW_CHARS),
            notionStatus: r.notionStatus,
            hasClient: r.hasClient,
            readAt: at,
          };
          const found = tx.select({ id: leadRows.id }).from(leadRows).where(and(eq(leadRows.project, r.project), eq(leadRows.pageId, pageId))).get();
          if (found) {
            tx.update(leadRows).set(fields).where(eq(leadRows.id, found.id)).run();
            continue;
          }
          tx.insert(leadRows).values({ project: r.project, pageId, ...fields, storedAt: at }).run();
          added++;
        }
        return added;
      });
    },

    open,

    async get(project: string, pageId: string): Promise<(LeadRow & { open: boolean }) | null> {
      const r = db
        .select({ row: leadRows, open: sql<number>`(case when ${SQL_OPEN} then 1 else 0 end)` })
        .from(leadRows)
        .where(and(eq(leadRows.project, project), eq(leadRows.pageId, norm(pageId))))
        .get();
      return r ? { ...r.row, open: r.open === 1 } : null;
    },

    /** The project's lead rows with this address (reply or account email), newest first: the send's conversion and the new-thread check. */
    async ofEmail(project: string, email: string): Promise<LeadRow[]> {
      const e = email.trim().toLowerCase();
      return db
        .select()
        .from(leadRows)
        .where(and(eq(leadRows.project, project), sql`(${leadRows.email} = ${e} or ${leadRows.accountEmail} = ${e})`))
        .orderBy(sql`${leadRows.receivedAt} desc`)
        .all();
    },

    /** Not now or Spam (verdicts 2 and 8): the row leaves the group, stored with the moment and the reason. */
    async dismiss(project: string, pageId: string, reason: LeadDismissReason, now: Date = new Date()): Promise<boolean> {
      return write(db, (tx) => tx.update(leadRows).set({ dismissedAt: now.toISOString(), dismissedReason: reason }).where(and(eq(leadRows.project, project), eq(leadRows.pageId, norm(pageId)))).run().changes > 0);
    },

    /** Undo of Not now or Spam: the row is open again (a Spam Undo also gets Status New back, by the caller). */
    async undismiss(project: string, pageId: string): Promise<boolean> {
      return write(db, (tx) => tx.update(leadRows).set({ dismissedAt: null, dismissedReason: null }).where(and(eq(leadRows.project, project), eq(leadRows.pageId, norm(pageId)))).run().changes > 0);
    },

    /** The Status the Hub just wrote (Spam, In progress, New on Undo), so the group follows before the next read. */
    async setStatus(project: string, pageIds: readonly string[], status: string): Promise<number> {
      if (!pageIds.length) return 0;
      return write(db, (tx) => tx.update(leadRows).set({ notionStatus: status }).where(and(eq(leadRows.project, project), inArray(leadRows.pageId, pageIds.map(norm)))).run().changes);
    },

    /**
     * S4: the first confirmed send to the lead. `clientPageId` is the linked or new Clients card (null when none was linked);
     * `note` is what the owner must do when Notion refused a write (null when all went through). Only the first conversion sets
     * `converted_at`; a later note (a retry) replaces the note only.
     */
    async markConverted(project: string, pageIds: readonly string[], o: { clientPageId: string | null; note: string | null }, now: Date = new Date()): Promise<number> {
      if (!pageIds.length) return 0;
      return write(db, (tx) => {
        let n = 0;
        for (const pageId of pageIds.map(norm)) {
          const row = tx.select({ id: leadRows.id, convertedAt: leadRows.convertedAt }).from(leadRows).where(and(eq(leadRows.project, project), eq(leadRows.pageId, pageId))).get();
          if (!row) continue;
          tx.update(leadRows)
            .set({ convertedAt: row.convertedAt ?? now.toISOString(), clientPageId: o.clientPageId, convertNote: o.note, ...(o.clientPageId ? { hasClient: true } : {}) })
            .where(eq(leadRows.id, row.id))
            .run();
          n++;
        }
        return n;
      });
    },

    /** How many people the Leads group lists (the status line's "N new leads"). */
    async openCount(project: string, from: string): Promise<number> {
      return (await open(project, from)).length;
    },

    /** The newest refusal note of a conversion (the doctor's Notion write row and the card's Needs-you line). */
    async lastConvertNote(project: string): Promise<{ pageId: string; note: string; at: string } | null> {
      const r = db
        .select({ pageId: leadRows.pageId, note: leadRows.convertNote, at: leadRows.convertedAt })
        .from(leadRows)
        .where(and(eq(leadRows.project, project), sql`${leadRows.convertNote} is not null`))
        .orderBy(sql`${leadRows.convertedAt} desc`)
        .get();
      return r?.note ? { pageId: r.pageId, note: r.note, at: r.at ?? "" } : null;
    },
  };
}
