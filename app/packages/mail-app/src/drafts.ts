import type { OsaRun } from "./osa";
import { bareId, FS, LS, RS, rawId } from "./records";
import { FIND_SCRIPT, LIST_DRAFTS_SCRIPT, TRASH_SCRIPT } from "./scripts/drafts";

// The Hub's own drafts as Mail holds them (P126 M1, from `@hub/send`): find by subject (Drafts, or Trash), list their heads,
// move recorded versions to Trash. Nothing here sends; `@hub/send`'s Mailer adds the send on top.

/** A draft as Mail holds it. */
export interface MailDraft {
  /** Mail's own id of the draft message; the key `send` and the trash step use. */
  ref: string;
  /** The draft's Message-ID header (without angle brackets), when Mail has one. */
  messageId: string | null;
  /** Mail account name the draft sits in. */
  account: string | null;
  /** The bare Message-ID its In-Reply-To names (P65: how the Hub finds a thread's draft), or null. */
  inReplyTo: string | null;
  /** From, as Mail shows it (`Name <addr>` or `addr`). */
  sender: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Plain text. */
  body: string;
  attachments: number;
}

export interface DraftQuery {
  mailRef: string | null;
  subject: string;
}

/**
 * One Mail draft the hub may move to Trash (P65, decision 0031): a version the Hub recorded, named by its account and
 * its own Message-ID as Mail returned it. The script moves a draft only when both still match, read just before the delete.
 */
export interface TrashItem {
  account: string;
  messageId: string;
}

/** A draft's headers without its text: what the sweep and the migration list (P65; the text is never read for this). */
export interface DraftHead {
  ref: string;
  messageId: string | null;
  account: string | null;
  subject: string;
  inReplyTo: string | null;
}

export function parseTrashOutput(out: string): { moved: string[]; refused: string[]; why: string[] } {
  const [moved = "", refused = "", why = ""] = out.replace(/[\r\n]+$/, "").split(FS);
  const ids = (v: string) => v.split(LS).map((x) => x.trim()).filter(Boolean);
  return { moved: ids(moved), refused: ids(refused), why: ids(why) };
}

export function parseFindOutput(out: string): MailDraft[] {
  const items = (v: string) => v.split(LS).map((x) => x.trim()).filter(Boolean);
  const drafts: MailDraft[] = [];
  for (const rec of out.split(RS)) {
    const p = rec.replace(/^[\r\n]+/, "").split(FS);
    if (p.length < 10) continue;
    const [ref, messageId, account, sender, to, cc, bcc, subject, body, n, irt = ""] = p as [string, string, string, string, string, string, string, string, string, string, string?];
    drafts.push({ ref, messageId: rawId(messageId) || null, account: account || null, inReplyTo: bareId(irt) || null, sender: sender || null, to: items(to), cc: items(cc), bcc: items(bcc), subject, body, attachments: Number(n) || 0 });
  }
  return drafts;
}

export function parseDraftHeads(out: string): DraftHead[] {
  const heads: DraftHead[] = [];
  for (const rec of out.split(RS)) {
    const p = rec.replace(/^[\r\n]+/, "").split(FS);
    if (p.length < 5) continue;
    const [ref, messageId, account, subject, irt] = p as [string, string, string, string, string];
    heads.push({ ref: ref.trim(), messageId: rawId(messageId) || null, account: account || null, subject, inReplyTo: bareId(irt) || null });
  }
  return heads;
}

export interface MailAppDrafts {
  findDrafts(q: DraftQuery): Promise<MailDraft[]>;
  findInTrash(q: DraftQuery): Promise<MailDraft[]>;
  listDrafts(): Promise<DraftHead[]>;
  trashDrafts(items: TrashItem[]): Promise<{ moved: string[]; refused: string[]; why?: string[] }>;
}

/** `read` runs the finds (a page waits on them, so the server passes the `read` budget); listing and trash keep `osa`. */
export function mailAppDrafts(osa: OsaRun, read: OsaRun = osa): MailAppDrafts {
  return {
    async findDrafts(q) {
      return parseFindOutput(await read(FIND_SCRIPT, [q.subject]));
    },
    async findInTrash(q) {
      return parseFindOutput(await read(FIND_SCRIPT, [q.subject, "trash"]));
    },
    async listDrafts() {
      return parseDraftHeads(await osa(LIST_DRAFTS_SCRIPT, []));
    },
    async trashDrafts(items) {
      if (items.length === 0) return { moved: [], refused: [] };
      return parseTrashOutput(await osa(TRASH_SCRIPT, items.flatMap((i) => [i.account, rawId(i.messageId)])));
    },
  };
}
