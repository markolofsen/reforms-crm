import { createHash } from "node:crypto";
import { withoutLeadingBlankLines, type DraftRow, type MailVersionRow } from "@hub/db";
import type { MailDraft, TrashItem } from "@hub/mail-app/drafts";
import { MAIL_NOT_ANSWERING_FIX, MailNotAnswering } from "@hub/mail-app/osa";
import { bareId } from "@hub/mail-app/records";
import type { Mailer } from "./mailer";
import type { SendDeps } from "./assess";
import { addresses, norm } from "./recipients";

// Which Mail draft a hub draft stands for, its Trash after a send, and the fingerprint Checked is bound to (P65, decision 0031).

/**
 * `mail`: the one draft. `aside`: other drafts with this subject and recipient that are not this thread's (left alone,
 * named only). `note`: Mail holds several drafts of this thread; such a read has no hash. `gone` (P56): Mail answered
 * and holds no draft for it at all, so the card looks in Trash.
 */
export type MailFound = { mail: MailDraft; reason?: undefined; note?: string; aside?: string; gone?: undefined } | { mail?: undefined; reason: string; note?: undefined; aside?: undefined; gone?: boolean };

/**
 * `strict` (Send, the dry run, Checked): one draft or a refusal, never a guess. `show` (the card's read, P53): with
 * several drafts of the thread it still shows one, with a `note`; the caller gives that text no hash.
 */
export type FindMode = "strict" | "show";

/** What narrows the search (P65): the project's Mail accounts (null: any) and the versions the Hub recorded for this draft. */
export interface FindScope {
  accounts?: readonly string[] | null;
  versions?: readonly Pick<MailVersionRow, "account" | "messageId" | "trashedAt">[];
}

const newestFirst = (list: MailDraft[]) => [...list].sort((a, b) => (Number(b.ref) || 0) - (Number(a.ref) || 0));
const ids = (list: MailDraft[]) => list.map((c) => c.ref).join(", ");

/** Is this Mail draft one of the versions the Hub recorded (its account and its own Message-ID)? The one test of authorship (decision 0031). */
export const isRecorded = (d: Pick<MailDraft, "account" | "messageId">, versions: FindScope["versions"]): boolean =>
  (versions ?? []).some((v) => bareId(v.messageId) === bareId(d.messageId) && (v.account ?? "").trim().toLowerCase() === (d.account ?? "").trim().toLowerCase());

/**
 * The one Mail draft a hub draft stands for (P65 verdict 2, decision 0031). The thread decides: a draft in one of the
 * project's accounts whose In-Reply-To is the draft's `mailRef` and whose To holds the client is the thread's draft,
 * whoever last edited it. Exactly one: it is the draft. Two or more: strict refuses and names every Mail id, saying which
 * ones the Hub wrote (its `mail_versions`); show shows the Hub's newest with a note. None by thread: the old rule for a
 * draft without In-Reply-To (by Message-ID, then one draft by subject and recipient). Read-only.
 */
export async function findMail(deps: { mailer: Pick<Mailer, "findDrafts"> }, draft: Pick<DraftRow, "mailRef" | "subject" | "toAddr">, mode: FindMode = "strict", scope: FindScope = {}): Promise<MailFound> {
  let all: MailDraft[] = [];
  try {
    all = await deps.mailer.findDrafts({ mailRef: draft.mailRef, subject: draft.subject });
  } catch (e) {
    if (e instanceof MailNotAnswering) return { reason: `${e.message}. ${MAIL_NOT_ANSWERING_FIX}` };
    return { reason: `Mail could not be read: ${(e as Error).message}` };
  }
  const own = scope.accounts ? new Set(scope.accounts.map((a) => a.trim().toLowerCase())) : null;
  const candidates = own ? all.filter((c) => own.has((c.account ?? "").trim().toLowerCase())) : all;
  const ref = bareId(draft.mailRef);
  const toAddr = addresses(draft.toAddr);
  const forClient = (c: MailDraft) => toAddr.every((a) => norm(c.to).includes(a));
  const thread = ref ? newestFirst(candidates.filter((c) => c.inReplyTo === ref && forClient(c))) : [];
  const hub = (c: MailDraft) => isRecorded(c, scope.versions);
  if (thread.length === 1) {
    const mail = thread[0] as MailDraft;
    const others = all.filter((c) => c !== mail && forClient(c) && c.inReplyTo !== ref);
    if (others.length === 0) return { mail };
    return { mail, aside: `Mail also holds ${others.length} other draft${others.length === 1 ? "" : "s"} with this subject for this address that do not answer this message (Mail id ${ids(others)}): left alone, never sent from here.` };
  }
  if (thread.length > 1) {
    const mine = thread.filter(hub);
    const who = thread.map((c) => `Mail id ${c.ref} ${hub(c) ? "is the Hub's version" : "is not the Hub's"}`).join("; ");
    const wait = `Mail holds ${thread.length} drafts that answer this message (${who}): keep one in Mail`;
    const shown = (mine[0] ?? thread[0]) as MailDraft;
    return mode === "show" ? { mail: shown, note: `${wait}. Shown: Mail id ${shown.ref}. Until one is left it cannot be Checked or sent.` } : { reason: wait };
  }
  // A draft without In-Reply-To (written by hand, or by an older writer): the old rule over every account, so a draft in
  // another account is still found, and refused by `assess` with its account named.
  const byId = ref ? all.filter((c) => bareId(c.messageId) === ref) : [];
  // P85b: a new thread answers nothing (no mailRef): the versions the Hub recorded for it come first.
  const recorded = ref ? [] : candidates.filter((c) => !c.inReplyTo && forClient(c) && hub(c));
  const pool = byId.length ? byId : recorded.length ? recorded : all.filter((c) => !c.inReplyTo && forClient(c));
  if (pool.length === 0) return { reason: `no draft in Mail with subject "${draft.subject}" for ${draft.toAddr}`, gone: true };
  if (pool.length > 1) {
    const newest = newestFirst(pool)[0] as MailDraft;
    const others = pool.filter((c) => c !== newest);
    if (mode === "show") return { mail: newest, note: `Mail holds ${pool.length} drafts with this subject for this address and none answers this message by its headers. Shown: the newest, Mail id ${newest.ref}. Keep one (delete Mail id ${ids(others)}); until then it cannot be Checked or sent.` };
    return { reason: `${pool.length} drafts in Mail match subject "${draft.subject}" for ${draft.toAddr} and none answers this message by its headers: keep the newest (Mail id ${newest.ref}) and delete the other${others.length === 1 ? "" : "s"} in Mail` };
  }
  return { mail: pool[0] as MailDraft };
}

/**
 * Moves the Hub's own versions of this draft to Trash (P65 verdict 3): every version recorded in `mail_versions` and not
 * yet trashed, except `keep` (a Message-ID), each re-checked by account and Message-ID in the script just before the
 * delete. A draft the owner wrote in the same thread is never in that record, so never in this list. Used after Send
 * (the siblings), Skip and Done. Marks what Mail moved. Throws only when Mail cannot be reached.
 */
export async function trashThread(deps: Pick<SendDeps, "mailer" | "repos">, draftId: number, keep: string | null = null): Promise<{ moved: string[]; refused: string[] }> {
  const live = (await deps.repos.mailVersions.ofDraft(draftId)).filter((v) => !v.trashedAt);
  const kept = bareId(keep);
  const items: TrashItem[] = live.filter((v) => !kept || bareId(v.messageId) !== kept).map((v) => ({ account: v.account, messageId: v.messageId }));
  if (items.length === 0) return { moved: [], refused: [] };
  const r = await deps.mailer.trashDrafts(items);
  const moved = new Set(r.moved.map(bareId));
  await deps.repos.mailVersions.markTrashed(live.filter((v) => moved.has(bareId(v.messageId))).map((v) => v.id));
  return r;
}

/** Fingerprint of what would go out: subject, recipients, text (as sent: no blank lines above it, P94). What Checked is bound to; the text itself is never kept. */
export function mailHash(m: Pick<MailDraft, "subject" | "to" | "cc" | "bcc" | "body">): string {
  return createHash("sha256").update(JSON.stringify([m.subject, norm(m.to), norm(m.cc), norm(m.bcc), withoutLeadingBlankLines(m.body)])).digest("hex");
}
