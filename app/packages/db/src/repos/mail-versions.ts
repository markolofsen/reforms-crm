import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "../client";
import { write } from "../tx";
import { mailVersions, mailWrites } from "../schema";
import { nowIso } from "./bulk-shared";

// The Hub's record of the Mail drafts it wrote (P65, decision 0031). Authorship is this record, never a line in the
// text: a Mail draft is moved to Trash by the Hub only when its account and `message id` match a row here. The text is
// never stored, only the hash of what Mail returned after the save (decision 0013).

export type MailVersionRow = typeof mailVersions.$inferSelect;
export type MailWriteRow = typeof mailWrites.$inferSelect;
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

// P65 S5 (decision 0031 addendum): how a Mail text is matched to what the Hub wrote, without keeping the text. Mail's
// read-back adds a leading line break and turns U+2028 into a line break (measured on 139335/139857), so texts are
// compared with every whitespace run collapsed to one space and the ends trimmed.
const collapse = (t: string): string => t.replace(/[\s\u2028\u2029]+/g, " ").trim();
const sha = (t: string): string => createHash("sha256").update(t).digest("hex");

/** The record of a text the Hub is about to write: hash and length of the collapsed text. */
export const textKey = (text: string): { hash: string; len: number } => {
  const c = collapse(text);
  return { hash: sha(c), len: c.length };
};

/** The hash of a whole text, collapsed: what a reply shell is matched by. */
export const shellHashOf = (text: string): string => sha(collapse(text));

/** The fingerprint of a version's text as Mail returned it (decision 0013: the hash, never the text). Kept as P65 S1 wrote it. */
export const versionHashOf = (text: string): string => sha(text.replace(/\s+$/, ""));

/** Does this Mail text begin with the text of that write (the quote the writer adds follows it)? */
export const startsWithWrite = (text: string, w: Pick<MailWriteRow, "textHash" | "textLen">): boolean => {
  const c = collapse(text);
  return c.length >= w.textLen && sha(c.slice(0, w.textLen)) === w.textHash && (c.length === w.textLen || c[w.textLen] === " ");
};

/**
 * Mail's own empty reply (P65 S5, saas 139835): one attribution line ending in ":" ("On 14 Nov 2026, at 14:26, Mark
 * Effect <…> wrote:"), then the answered message and nothing else (a `> ` quote prefix allowed). It holds nothing anyone
 * typed, so it is Mail's artifact of a reply, never the owner's text. Needs the answered message's text to be sure.
 */
export const isReplyShell = (body: string, original: string | null | undefined): boolean => {
  const o = collapse(original ?? "");
  if (!o) return false;
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const i = lines.findIndex((l) => l.trim() !== "");
  const head = (lines[i] ?? "").trim();
  if (i < 0 || head.length > 300 || !/:$/.test(head)) return false;
  return collapse(lines.slice(i + 1).map((l) => l.replace(/^>\s?/, "")).join("\n")) === o;
};

/** A thread draft as the matcher needs it: where it sits, its own Message-ID, its Mail id and its text. */
export interface ThreadDraft {
  ref: string;
  account: string | null;
  messageId: string | null;
  body: string;
}

export interface Adoption<D extends ThreadDraft = ThreadDraft> {
  draft: D;
  /** The open write it is the late save or the shell of; null when it matched a recorded version's text. */
  writeId: number | null;
  why: "late_save" | "same_text" | "shell" | "mail_shell";
}

const accountKey = (a: string | null | undefined) => (a ?? "").trim().toLowerCase();

/**
 * Pure (decision 0031 addendum point 2): which unrecorded drafts of a thread are the Hub's own. A draft already recorded
 * (account and Message-ID) is skipped; one whose collapsed text (a) begins with an open write's text, (b) equals a
 * recorded version's text, (c) equals an open write's reply shell, or (d) is Mail's empty reply to the answered message
 * (`isReplyShell`, when `original` is given) is adopted. Anything else stays the owner's.
 */
export function adoptable<D extends ThreadDraft>(drafts: readonly D[], versions: readonly Pick<MailVersionRow, "account" | "messageId" | "hash">[], writes: readonly Pick<MailWriteRow, "id" | "textHash" | "textLen" | "shellHash" | "settledAt">[], original: string | null = null): Adoption<D>[] {
  const recorded = new Set(versions.map((v) => `${accountKey(v.account)}\u0000${bareRef(v.messageId)}`));
  const hashes = new Set(versions.map((v) => v.hash));
  const open = writes.filter((w) => !w.settledAt);
  const out: Adoption<D>[] = [];
  for (const d of drafts) {
    if (!d.messageId || recorded.has(`${accountKey(d.account)}\u0000${bareRef(d.messageId)}`)) continue;
    // Newest write first: a late save belongs to the last write whose text it starts with.
    const late = [...open].sort((a, b) => b.id - a.id).find((w) => startsWithWrite(d.body, w));
    if (late) {
      out.push({ draft: d, writeId: late.id, why: "late_save" });
      continue;
    }
    if (hashes.has(versionHashOf(d.body))) {
      out.push({ draft: d, writeId: null, why: "same_text" });
      continue;
    }
    const shell = open.find((w) => w.shellHash && w.shellHash === shellHashOf(d.body));
    if (shell) out.push({ draft: d, writeId: shell.id, why: "shell" });
    else if (isReplyShell(d.body, original)) out.push({ draft: d, writeId: null, why: "mail_shell" });
  }
  return out;
}

export function mailVersionsRepo(db: Db) {
  return {
    /**
     * One version the writer saved. Returns its id. A version already recorded for the project (same account and
     * Message-ID, not trashed) keeps its row (P65 S5: the card's read may adopt a late save while its writer still waits).
     */
    async add(v: NewMailVersion): Promise<number> {
      const mid = v.messageId.trim().replace(/^<|>$/g, "");
      return write(db, (tx) => {
        const known = tx.select({ id: mailVersions.id }).from(mailVersions).where(and(eq(mailVersions.project, v.project), eq(mailVersions.account, v.account), eq(mailVersions.messageId, mid), isNull(mailVersions.trashedAt))).get();
        if (known) return known.id;
        return tx
          .insert(mailVersions)
          .values({ project: v.project, mailRef: bareRef(v.mailRef), draftId: v.draftId ?? null, account: v.account, mailId: v.mailId, messageId: mid, hash: v.hash, source: v.source, signatureFallback: v.signatureFallback ?? null, writtenAt: v.writtenAt ?? nowIso() })
          .returning({ id: mailVersions.id })
          .get().id;
      });
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

export interface NewMailWrite {
  project: string;
  mailRef: string;
  draftId?: number | null;
  /** The text the Hub asks Mail to save (before Mail adds its quote): only its `textKey` is stored. */
  text: string;
  startedAt?: string;
}

/** The Hub's record of the Mail writes it started (P65 S5): one row before every save, settled when the save is found. */
export function mailWritesRepo(db: Db) {
  return {
    async start(w: NewMailWrite): Promise<number> {
      const k = textKey(w.text);
      return write(db, (tx) => tx.insert(mailWrites).values({ project: w.project, mailRef: bareRef(w.mailRef), draftId: w.draftId ?? null, textHash: k.hash, textLen: k.len, startedAt: w.startedAt ?? nowIso() }).returning({ id: mailWrites.id }).get().id);
    },

    /** The save was found (or adopted later): which Mail draft it became. */
    async settle(id: number, r: { mailId: number; messageId: string }): Promise<void> {
      write(db, (tx) => tx.update(mailWrites).set({ settledAt: nowIso(), mailId: r.mailId, messageId: r.messageId.trim().replace(/^<|>$/g, "") }).where(and(eq(mailWrites.id, id), isNull(mailWrites.settledAt))).run());
    },

    /** Mail's reply shell of this write, as the writer saw it before it set the text (the hash only). */
    async shell(id: number, text: string): Promise<void> {
      write(db, (tx) => tx.update(mailWrites).set({ shellHash: shellHashOf(text) }).where(eq(mailWrites.id, id)).run());
    },

    /** The writes of one thread, or of one hub draft, newest first: what a late draft is matched against. */
    async ofThread(project: string, mailRef: string, draftId: number | null = null): Promise<MailWriteRow[]> {
      const thread = and(eq(mailWrites.project, project), eq(mailWrites.mailRef, bareRef(mailRef)));
      const where = draftId === null ? thread : or(thread, eq(mailWrites.draftId, draftId));
      return db.select().from(mailWrites).where(where).orderBy(desc(mailWrites.id)).all();
    },
  };
}
