import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { write } from "../tx";
import { mailVersions } from "../schema";
import { nowIso } from "./bulk-shared";

// The Hub's record of the Mail drafts it wrote (P65, decision 0031). Authorship is this record, never a line in the
// text: a Mail draft is moved to Trash by the Hub only when its account and `message id` match a row here. The text is
// never stored, only the hash of what Mail returned after the save (decision 0013).

export type MailVersionRow = typeof mailVersions.$inferSelect;
export type MailVersionSource = MailVersionRow["source"];

export interface NewMailVersion {
  project: string;
  /** The Message-ID of the message the draft answers (any form: stored bare and lowercased). */
  mailRef: string;
  draftId?: number | null;
  account: string;
  mailId: number;
  /** The draft's own Message-ID, as Mail returned it (angle brackets removed, case kept: Mail's scripts are given it back). */
  messageId: string;
  hash: string;
  source: MailVersionSource;
  signatureFallback?: string | null;
  writtenAt?: string;
}

/** A Message-ID or `mailRef` as rows store and compare it. */
export const bareRef = (x: string | null | undefined): string => (x ?? "").trim().replace(/^<|>$/g, "").toLowerCase();

export function mailVersionsRepo(db: Db) {
  return {
    /** One version the writer saved. Returns its id. */
    async add(v: NewMailVersion): Promise<number> {
      return write(db, (tx) =>
        tx
          .insert(mailVersions)
          .values({ project: v.project, mailRef: bareRef(v.mailRef), draftId: v.draftId ?? null, account: v.account, mailId: v.mailId, messageId: v.messageId.trim().replace(/^<|>$/g, ""), hash: v.hash, source: v.source, signatureFallback: v.signatureFallback ?? null, writtenAt: v.writtenAt ?? nowIso() })
          .returning({ id: mailVersions.id })
          .get().id,
      );
    },

    /** Every version of one thread in a project, newest first (trashed ones included: Restore looks for them in Trash). */
    async ofThread(project: string, mailRef: string): Promise<MailVersionRow[]> {
      return db.select().from(mailVersions).where(and(eq(mailVersions.project, project), eq(mailVersions.mailRef, bareRef(mailRef)))).orderBy(desc(mailVersions.id)).all();
    },

    /** Every version of one hub draft, newest first. */
    async ofDraft(draftId: number): Promise<MailVersionRow[]> {
      return db.select().from(mailVersions).where(eq(mailVersions.draftId, draftId)).orderBy(desc(mailVersions.id)).all();
    },

    /** Every version of a project (the sweep and Sent detection join Mail's headers to these). */
    async ofProject(project: string): Promise<MailVersionRow[]> {
      return db.select().from(mailVersions).where(eq(mailVersions.project, project)).orderBy(desc(mailVersions.id)).all();
    },

    /** Versions of this thread written before `hub record-draft` made its draft row: they become that draft's. */
    async link(project: string, mailRef: string, draftId: number): Promise<number> {
      return write(db, (tx) => tx.update(mailVersions).set({ draftId }).where(and(eq(mailVersions.project, project), eq(mailVersions.mailRef, bareRef(mailRef)), isNull(mailVersions.draftId))).run().changes);
    },

    /** Mail moved these versions to Trash (by row id). */
    async markTrashed(ids: readonly number[]): Promise<void> {
      if (ids.length === 0) return;
      write(db, (tx) => tx.update(mailVersions).set({ trashedAt: nowIso() }).where(and(inArray(mailVersions.id, [...ids]), isNull(mailVersions.trashedAt))).run());
    },
  };
}
