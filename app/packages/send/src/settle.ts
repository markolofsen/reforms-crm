import { adoptable, isReplyShell, shellHashOf, versionHashOf, type DraftRow, type Repos } from "@hub/db";
import { normalizeAddress } from "@hub/projects/parse";
import type { MailDraft } from "@hub/mail-app/drafts";
import { bareId } from "@hub/mail-app/records";
import type { Mailer } from "./mailer";

// P65 S5 (decision 0031 addendum points 2 and 3): the card's read heals a thread the Hub itself crowded. A slow Mail can
// save a write after the writer stopped waiting, or save it twice, so the thread holds several drafts that are all the
// Hub's. The unrecorded ones whose text matches the Hub's record are adopted (`mail_versions`, `adopted`); then, of the
// Hub's versions in Drafts, the newest (Mail's highest id, never a reply shell) stays and the others go to Trash, each
// re-checked by account and Message-ID just before Mail's delete. A draft the Hub did not write is never adopted or moved.

const ADDRESS = /[^\s,;<>"']+@[^\s,;<>"']+/g;
const addresses = (v: string | null | undefined): string[] => (v?.match(ADDRESS) ?? []).map(normalizeAddress);
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export interface SettleResult {
  /** Mail ids adopted as the Hub's versions. */
  adopted: string[];
  /** Message-IDs moved to Trash, and the ones Mail refused. */
  moved: string[];
  refused: string[];
}

/** The thread's drafts (project accounts, In-Reply-To = mailRef, To holds the client), as `findMail` defines it. */
export function threadOf(all: readonly MailDraft[], draft: Pick<DraftRow, "mailRef" | "toAddr">, accounts: readonly string[]): MailDraft[] {
  const ref = bareId(draft.mailRef);
  if (!ref) return [];
  const own = new Set(accounts.map(lower));
  const to = addresses(draft.toAddr);
  return all.filter((c) => own.has(lower(c.account)) && c.inReplyTo === ref && to.every((a) => c.to.map(normalizeAddress).includes(a)));
}

/** Adopts the Hub's late saves in this thread and moves the Hub's superseded versions to Trash. Throws only when Mail cannot be read. */
export async function settleThread(deps: { mailer: Pick<Mailer, "findDrafts" | "trashDrafts">; repos: Repos; /** The answered message's text (Mail's empty reply is recognised against it); absent or null: not recognised. */ original?: () => Promise<string | null> }, draft: Pick<DraftRow, "id" | "project" | "mailRef" | "subject" | "toAddr">, accounts: readonly string[]): Promise<SettleResult> {
  const none: SettleResult = { adopted: [], moved: [], refused: [] };
  if (!draft.mailRef) return none;
  const thread = threadOf(await deps.mailer.findDrafts({ mailRef: draft.mailRef, subject: draft.subject }), draft, accounts);
  if (thread.length < 2) return none;
  const writes = await deps.repos.mailWrites.ofThread(draft.project, draft.mailRef, draft.id);
  const recorded = await deps.repos.mailVersions.ofDraft(draft.id);
  const known = (d: MailDraft) => recorded.some((v) => !v.trashedAt && lower(v.account) === lower(d.account) && bareId(v.messageId) === bareId(d.messageId));
  // The answered message is read only when an unrecorded draft is left to judge (one more Mail read, rare).
  const original = thread.some((d) => !known(d)) && deps.original ? await deps.original().catch(() => null) : null;
  const found = adoptable(thread, recorded, writes, original);
  const adopted: string[] = [];
  for (const a of found) {
    if (!a.draft.messageId || !a.draft.account) continue;
    const mailId = Number(a.draft.ref) || 0;
    await deps.repos.mailVersions.add({ project: draft.project, mailRef: draft.mailRef, draftId: draft.id, account: a.draft.account, mailId, messageId: a.draft.messageId, hash: versionHashOf(a.draft.body), source: "adopted" });
    if (a.writeId !== null && a.why === "late_save") await deps.repos.mailWrites.settle(a.writeId, { mailId, messageId: a.draft.messageId });
    adopted.push(a.draft.ref);
  }
  const versions = (await deps.repos.mailVersions.ofDraft(draft.id)).filter((v) => !v.trashedAt);
  const rowOf = (d: MailDraft) => versions.find((v) => lower(v.account) === lower(d.account) && bareId(v.messageId) === bareId(d.messageId));
  const shells = new Set(writes.flatMap((w) => (w.shellHash ? [w.shellHash] : [])));
  const hubs = thread.filter((d) => rowOf(d) !== undefined).sort((a, b) => (Number(b.ref) || 0) - (Number(a.ref) || 0));
  // A reply shell (this write's, Mail's empty reply, or the empty draft Mail kept from a refused write, P83) is never the
  // draft that stays; when the thread holds nothing but shells, they all go (they hold nobody's text).
  const isShell = (d: MailDraft) => !d.body.trim() || shells.has(shellHashOf(d.body)) || isReplyShell(d.body, original);
  const keep = hubs.find((d) => !isShell(d));
  const out = hubs.filter((d) => d !== keep);
  if (out.length === 0) return { ...none, adopted };
  const r = await deps.mailer.trashDrafts(out.map((d) => ({ account: d.account ?? "", messageId: d.messageId ?? "" })));
  const moved = new Set(r.moved.map(bareId));
  await deps.repos.mailVersions.markTrashed(
    out.flatMap((d) => {
      const v = rowOf(d);
      return v && moved.has(bareId(d.messageId)) ? [v.id] : [];
    }),
  );
  return { adopted, ...r };
}
