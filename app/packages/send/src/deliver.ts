import { RepoError, type SendRow } from "@hub/db";
import { bareId, type MailDraft } from "./mailer";
import { assess, type SendDeps, type SendMode } from "./assess";
import { trashThread } from "./find";
import { addresses, norm, same } from "./recipients";

// `hub send <draftId>` and the one place a mail goes out (`deliver`, also the due run's): the audit row first, then Mail.

export type SendOutcome = { code: 0 | 1 | 2; line: string };
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const refuse = (draftId: number, reasons: string[]): SendOutcome => ({ code: 2, line: line({ ok: false, draftId, refused: reasons }) });
const fields = (m: MailDraft) => ({ from: m.sender, to: m.to, cc: m.cc, subject: m.subject });

/**
 * `hub send <draftId>`. `confirm` (the server's Send) is the recipient and subject the person saw; a mismatch refuses. Dry run unless `apply`: it reads Mail and prints what it would send (full text included). With
 * `apply` it writes the audit row first, sends, and finishes the row. Exit codes: 0 ok, 1 failure
 * while sending or writing, 2 refused (nothing sent, nothing written).
 */
export async function sendDraft(deps: SendDeps, o: { draftId: number; apply: boolean; actor: string; confirm?: { to: string[]; subject: string } }): Promise<SendOutcome> {
  const a = await assess(deps, o.draftId, { mode: "manual" });
  if (!a.ok || !a.mail || !a.project) return refuse(o.draftId, a.reasons);
  const m = a.mail;
  // What a person confirmed on screen must be what Mail holds now: the draft may have been edited since the dry run.
  if (o.confirm && (o.confirm.subject !== m.subject || !same(norm(o.confirm.to.flatMap(addresses)), norm(m.to)))) {
    return refuse(o.draftId, ["the draft in Mail changed since you looked at it (recipient or subject): read it again before sending"]);
  }
  if (!o.apply) return { code: 0, line: line({ ok: true, dryRun: true, draftId: o.draftId, project: a.project, ...fields(m), body: m.body, note: "nothing sent; add --apply to send" }) };
  const draft = await deps.repos.drafts.get(o.draftId);
  return deliver(deps, { draftId: o.draftId, project: a.project, mode: "manual", actor: o.actor, mail: m, mailRef: draft?.mailRef ?? null });
}
export async function deliver(deps: SendDeps, o: { draftId: number; project: string; mode: SendMode; actor: string; mail: MailDraft; queued?: SendRow; mailRef?: string | null }): Promise<SendOutcome> {
  // Exactly the Mail text goes out, and the audit row holds it (decision 0031: nothing of the Hub's is in it).
  const m = o.mail;
  let row: SendRow;
  try {
    row = o.queued ?? (await deps.repos.sends.begin({ project: o.project, draftId: o.draftId, mode: o.mode, status: "sending", actor: o.actor, at: (deps.now?.() ?? new Date()).toISOString(), sender: m.sender, to: m.to.join(", "), cc: m.cc.join(", ") || null, bcc: m.bcc.join(", ") || null, subject: m.subject, body: m.body, mailRef: m.messageId }));
  } catch (e) {
    if (e instanceof RepoError) return refuse(o.draftId, [e.message]);
    return { code: 1, line: line({ ok: false, draftId: o.draftId, error: (e as Error).message }) };
  }
  let sent: { messageId: string | null };
  try {
    sent = await deps.mailer.send(m, o.mailRef ?? null);
  } catch (e) {
    await deps.repos.sends.markFailed(row.id, (e as Error).message);
    return { code: 1, line: line({ ok: false, draftId: o.draftId, sendId: row.id, error: `not sent: ${(e as Error).message}` }) };
  }
  try {
    await deps.repos.sends.markSent(row.id, sent.messageId);
  } catch (e) {
    return { code: 1, line: line({ ok: false, draftId: o.draftId, sendId: row.id, error: `the mail WAS sent but its log row could not be finished (${(e as Error).message}); send ${row.id} stays "sending"` }) };
  }
  await Promise.resolve()
    .then(() => deps.onSent?.({ project: o.project, draftId: o.draftId, to: m.to, at: (deps.now?.() ?? new Date()).toISOString(), via: "hub" }))
    .catch(() => undefined);
  // The send moved the sent draft to Trash; any other version the Hub recorded for this draft follows it (P56, P65). Best
  // effort: the mail is out, and `hub drafts sweep` finds what is left. The sent one is marked trashed too.
  await (async () => {
    const versions = await deps.repos.mailVersions.ofDraft(o.draftId);
    await deps.repos.mailVersions.markTrashed(versions.filter((v) => !v.trashedAt && bareId(v.messageId) === bareId(m.messageId)).map((v) => v.id));
    await trashThread(deps, o.draftId, m.messageId);
  })().catch(() => undefined);
  return { code: 0, line: line({ ok: true, sent: true, draftId: o.draftId, sendId: row.id, ...fields(m) }) };
}
