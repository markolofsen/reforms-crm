import { RepoError, type SendRow } from "@hub/db";
import type { MailDraft } from "@hub/mail-app/drafts";
import { MailNotAnswering } from "@hub/mail-app/osa";
import { bareId } from "@hub/mail-app/records";
import { assess, type SendDeps, type SendMode } from "./assess";
import { trashThread } from "./find";
import { addresses, norm, same } from "./recipients";

// `hub send <draftId>` and the one place a mail goes out. P112 S2: the stages are functions of their own, in this order, each on
// fresh reads: the assessment (`assess`, every reason in words: the project's lifecycle, Stop sending, Checked bound to the text's
// hash, the recipients policy), the authorization (`authorizeMail`: what the person confirmed is what Mail holds now), the audit
// (`auditMail`: the `send_log` row first, Stop sending re-checked in its write), and the delivery (`transmit`: one Mailer send, no
// retry). The ticket proves the person's click and is taken by the server's route before `sendDraft`; the CLI is the owner at his
// terminal. Mail has no other authority: the agent never sends an email, in any mode (decision 0046 point 4), and no server
// runner does (decision 0048 point 12).

export type SendOutcome = { code: 0 | 1 | 2; line: string };
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const refuse = (draftId: number, reasons: string[]): SendOutcome => ({ code: 2, line: line({ ok: false, draftId, refused: reasons }) });
const fields = (m: MailDraft) => ({ from: m.sender, to: m.to, cc: m.cc, subject: m.subject });

/** The authorization: the recipients and subject the person saw (the server's Send) must be what Mail holds now. Every reason, or none. */
export function authorizeMail(m: MailDraft, confirm?: { to: string[]; subject: string }): string[] {
  if (confirm && (confirm.subject !== m.subject || !same(norm(confirm.to.flatMap(addresses)), norm(m.to)))) {
    return ["the draft in Mail changed since you looked at it (recipient or subject): read it again before sending"];
  }
  return [];
}

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
  const changed = authorizeMail(m, o.confirm);
  if (changed.length) return refuse(o.draftId, changed);
  if (!o.apply) return { code: 0, line: line({ ok: true, dryRun: true, draftId: o.draftId, project: a.project, ...fields(m), body: m.body, note: "nothing sent; add --apply to send" }) };
  const draft = await deps.repos.drafts.get(o.draftId);
  return deliver(deps, { draftId: o.draftId, project: a.project, mode: "manual", actor: o.actor, mail: m, mailRef: draft?.mailRef ?? null });
}

type DeliverInput = { draftId: number; project: string; mode: SendMode; actor: string; mail: MailDraft; queued?: SendRow; mailRef?: string | null };

/** The audit: the `send_log` row first (a queued row the due run claimed is already that row). Exactly the Mail text, as it goes out (decision 0031). */
export async function auditMail(deps: SendDeps, o: DeliverInput): Promise<{ row: SendRow } | { outcome: SendOutcome }> {
  if (o.queued) return { row: o.queued };
  const m = o.mail;
  try {
    return { row: await deps.repos.sends.begin({ project: o.project, draftId: o.draftId, mode: o.mode, status: "sending", actor: o.actor, at: (deps.now?.() ?? new Date()).toISOString(), sender: m.sender, to: m.to.join(", "), cc: m.cc.join(", ") || null, bcc: m.bcc.join(", ") || null, subject: m.subject, body: m.body, mailRef: m.messageId }) };
  } catch (e) {
    if (e instanceof RepoError) return { outcome: refuse(o.draftId, [e.message]) };
    return { outcome: { code: 1, line: line({ ok: false, draftId: o.draftId, error: (e as Error).message }) } };
  }
}

/** The delivery: one Mailer send of the audited row, the row finished, the sent notice, the Hub's other versions to Trash. Never retried. */
async function transmit(deps: SendDeps, row: SendRow, o: DeliverInput): Promise<SendOutcome> {
  const m = o.mail;
  let sent: { messageId: string | null };
  try {
    sent = await deps.mailer.send(m, o.mailRef ?? null);
  } catch (e) {
    // P147 D4 (decision 0055 point 6): Mail did not answer in time, so whether it sent is unknown. The row stays `sending`:
    // `assess` refuses a second send of this draft, a Resume skips it, and Overview says to look in Mail's Sent folder.
    if (e instanceof MailNotAnswering) return { code: 1, line: line({ ok: false, draftId: o.draftId, sendId: row.id, unknown: true, error: `unknown: Mail did not answer (${e.message}); send ${row.id} stays "sending": look in Mail's Sent folder before sending it again` }) };
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

/** The audit, then the delivery: the one place a mail goes out (the manual send's and the due run's). */
export async function deliver(deps: SendDeps, o: DeliverInput): Promise<SendOutcome> {
  const audited = await auditMail(deps, o);
  if ("outcome" in audited) return audited.outcome;
  return transmit(deps, audited.row, o);
}
