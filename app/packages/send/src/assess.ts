import { unresolvedMarkers } from "@hub/config";
import { LEAD_FIRST_REPLY_REASON, LEAD_REPLY_INTENT } from "@hub/config/lead-pass";
import { withoutLeadingBlankLines, type DraftRow, type Repos, type SendRow } from "@hub/db";
import { isOwnAddress } from "@hub/projects/addresses";
import { checkDraftRecipients } from "@hub/projects/guard";
import { projectStore } from "@hub/projects/store";
import { normalizeAddress } from "@hub/projects/parse";
import type { ProjectConfig } from "@hub/projects/model";
import type { MailDraft } from "@hub/mail-app/drafts";
import type { Mailer } from "./mailer";
import { findMail, mailHash } from "./find";
import { addresses, DAY_MS, norm, same } from "./recipients";

// `hub send` (decision 0011, plan P23). The only code that sends mail. What a project allows (send.*, draft.recipients) is
// its send policy file (P49 S11), never project.md, which the agent may edit. Every send, manual or automatic, goes through
// `assess` first: the same refusals for both, strictest for autosend. Nothing here is reachable from an agent session.

export interface SendDeps {
  repos: Repos;
  mailer: Mailer;
  projectsDir: string;
  /** `hubPaths().stateProjects`: each project's send-policy.json (P49 S11), the only source of send.* and draft.recipients. */
  policyDir: string;
  /** `allow_list` of config/config.json: what `draft.recipients: test` means. */
  allowList: string[];
  now?: () => Date;
  /**
   * P89: told after a send is out and its log row is finished (the Notion stamp of who sent). Awaited but never trusted: a throw
   * or a rejection is swallowed here, so it can neither fail nor undo a send that already left.
   */
  onSent?: (s: SentNotice) => Promise<void> | void;
}

/** One confirmed send, as `onSent` hears it (from the send door here, or from Sent detection in the server). */
export interface SentNotice { project: string; draftId: number; to: string[]; at: string; via: string }

export type SendMode = "manual" | "auto";

export interface Assessment {
  ok: boolean;
  reasons: string[];
  draftId: number;
  project?: string;
  mail?: MailDraft;
  config?: ProjectConfig;
}

export interface AssessOptions {
  mode: SendMode;
  /** The queued row being sent (due run): it is the draft's own live row, not a second send; its snapshot must match Mail. */
  queued?: SendRow;
  /** Enqueue: count the daily cap. */
  checkCap?: boolean;
}

/**
 * Everything that must hold before one draft is sent, read fresh from the database, project.md and Mail. Returns every
 * reason found (not just the first) so the owner sees the whole list in one dry run.
 */
export async function assess(deps: SendDeps, draftId: number, o: AssessOptions): Promise<Assessment> {
  const now = deps.now?.() ?? new Date();
  const reasons: string[] = [];
  const out = (extra: Partial<Assessment> = {}): Assessment => ({ ok: reasons.length === 0, reasons, draftId, ...extra });
  const auto = o.mode === "auto";

  const s = await deps.repos.sends.subject(draftId);
  if (!s) {
    reasons.push("no such draft");
    return out();
  }
  const { draft, client } = s;
  const project = draft.project;

  for (const r of await deps.repos.sends.forDraft(draftId)) {
    if (r.id === o.queued?.id) continue;
    if (r.status === "sent") reasons.push(`already sent (send ${r.id}, ${r.doneAt ?? r.createdAt})`);
    else if (r.status === "sending") reasons.push(`send ${r.id} is in progress or was interrupted: check Mail's Sent folder, then resolve it`);
    else if (r.status === "queued") reasons.push(`already queued as send ${r.id}, due ${r.dueAt}`);
    // A cancel or a failure of an autosend is final for autosend: it never retries or re-queues on its own. A person can still send by hand.
    else if (auto && r.mode === "auto" && (r.status === "cancelled" || r.status === "failed")) reasons.push(`an earlier autosend (send ${r.id}) ${r.status}: send it by hand if it is still wanted`);
  }
  if (draft.status !== "ready") reasons.push(`the draft is ${draft.status}, not ready`);
  if (!auto && !draft.checked) reasons.push("the draft is not Checked (accepted) yet");
  // P47 decision 5: a follow-up step is never sent by the hub, in any mode (reason `sequence-step`): the owner sends it from Mail.
  if (draft.enrollmentId != null) reasons.push("sequence-step: a follow-up step is sent by you from Mail, never by the hub");
  // P142 verdict 7 (decision 0050 point 5): a follow-up nudge of the sweep is never sent by autosend; the owner's own Send sends it.
  if (auto && draft.followUpN != null) reasons.push("follow-up-nudge: a follow-up nudge is sent by your click, never by autosend");
  // P147 verdict 11 (decision 0055 point 4): the first reply to a lead (a draft of the day's lead batch) is never sent by autosend.
  if (auto && draft.batchId != null && (await deps.repos.batches.get(draft.project, draft.batchId))?.intent === LEAD_REPLY_INTENT) reasons.push(LEAD_FIRST_REPLY_REASON);
    if (draft.injectionSuspected) reasons.push("the mail it answers was flagged injection_suspected: never sent by the hub");
  if (client.marks.includes("do_not_contact")) reasons.push("the client is marked do_not_contact");

  let config: ProjectConfig | undefined;
  try {
    config = projectStore({ projects: deps.projectsDir, stateProjects: deps.policyDir }).config(project);
  } catch (e) {
    reasons.push(`project ${project} cannot be loaded: ${(e as Error).message}`);
  }
  if (config) {
    if (config.status !== "active") reasons.push(`project ${project} is ${config.status}, not active`);
    if (auto) {
      if (config.send.mode !== "auto") reasons.push(`project ${project} has send.mode ${config.send.mode}`);
      if (!draft.mailClass) reasons.push("the draft has no mail class, so autosend cannot admit it");
      else if (!config.send.classes.includes(draft.mailClass)) reasons.push(`class ${draft.mailClass} is not in send.classes of ${project}`);
    }
  }
  if (await deps.repos.sends.isStopped(project)) reasons.push("Stop all is on");

  if (auto && o.checkCap && config) {
    const n = await deps.repos.sends.autoCountSince(project, new Date(now.getTime() - DAY_MS).toISOString());
    if (n >= config.send.dailyCap) reasons.push(`daily cap reached: ${n} of ${config.send.dailyCap} in the last 24 hours`);
  }

  // The draft as Mail holds it: that is the text and the recipients that would really go out.
  const found = await findMail(deps, draft, "strict", { accounts: config?.mail.accounts ?? null, versions: await deps.repos.mailVersions.ofDraft(draft.id) });
  if (!found.mail) {
    reasons.push(found.reason);
    return out({ project, ...(config ? { config } : {}) });
  }
  // P94: the text that goes out starts with the text. Mail reads a reply draft back with its empty top line as a leading
  // line break; set into the new reply at Send it was a second blank line above every reply. The Checked hash, the queued
  // snapshot, the audit row and the door all see this same text.
  const mail = { ...found.mail, body: withoutLeadingBlankLines(found.mail.body) };

  if (config) {
    const accounts = config.mail.accounts.map((a) => a.trim().toLowerCase());
    if (!mail.account || !accounts.includes(mail.account.trim().toLowerCase())) reasons.push(`the draft sits in account "${mail.account ?? "?"}", not one of ${project}'s (${config.mail.accounts.join(", ") || "none"})`);
    const from = addresses(mail.sender)[0];
    if (!from) reasons.push("the draft has no sender");
    // P58: a reply goes from the address the client wrote to (when the account can send as it) or from the account that
    // received it; so the From is the project's own: mail.sender, one of its accounts, or an address on its addresses,
    // aliases or domains. Mail itself lets an account send only as its own addresses.
    else if (!(config.mail.sender && from === normalizeAddress(config.mail.sender)) && !isOwnAddress(from, config.mail)) reasons.push(`the draft's sender ${from} is not one of ${project}'s addresses (mail.sender ${config.mail.sender ?? "unset"}, mail.accounts, mail.addresses, mail.domains)`);
    const everyone = [...mail.to, ...mail.cc, ...mail.bcc];
    // P58 point 3: a reply to our own address (a self-sent test answered to the brand or the mailbox itself).
    const ours = everyone.filter((a) => isOwnAddress(a, config.mail) || (config.mail.sender !== null && config.mail.sender !== undefined && normalizeAddress(a) === normalizeAddress(config.mail.sender)));
    if (ours.length) reasons.push(`the draft is addressed to this project's own address ${[...new Set(ours.map(normalizeAddress))].join(", ")}: a reply goes to the client, never to us`);
    const g = checkDraftRecipients(config, everyone, deps.allowList);
    if (!g.ok) reasons.push(`draft.recipients of ${project} does not permit ${g.blocked.join(", ")}`);
  }
  if (mail.to.length === 0) reasons.push("the draft has no To recipient");
  if (mail.attachments > 0) reasons.push(`the draft has ${mail.attachments} attachment(s): the hub sends plain text only`);
  // What goes out is exactly the Mail text: nothing of the Hub's is in it (decision 0031), so nothing is removed.
  if (!mail.body.trim()) reasons.push("the draft text is empty");
  const left = unresolvedMarkers(`${mail.subject}\n${mail.body}`);
  if (left.length) reasons.push(`a placeholder is left in the text: ${left[0]}`);

  const safety = await deps.repos.sends.safetyOf(draftId, { subject: mail.subject, toAddr: mail.to.join(","), ccAddr: mail.cc.join(",") || null, body: mail.body }, now);
  // A person sending sees the amber results in the admin and gates only on red; autosend has nobody to judge, so any unacknowledged one stops it.
  for (const r of safety) if (!r.acked && (auto || r.level === "red")) reasons.push(`safety (${r.kind}): ${r.text}`);

  if (auto) {
    const recorded = norm([...addresses(draft.toAddr), ...addresses(draft.ccAddr)]);
    if (mail.bcc.length) reasons.push("the draft has Bcc recipients: not autosent");
    if (!same(norm([...mail.to, ...mail.cc]), recorded)) reasons.push("the recipients in Mail differ from the ones recorded with the draft");
  }
  // Checked is bound to the text that was read (decision 0013): a draft edited in Mail since needs a new read and a new tick.
  if (!auto && draft.checkedHash && draft.checkedHash !== mailHash(mail)) {
    reasons.push("the draft changed in Mail after it was Checked: read it again and tick Checked again");
    await deps.repos.drafts.setChecked(draftId, false);
  }
  if (o.queued && (o.queued.subject !== mail.subject || o.queued.body !== mail.body || !same(norm(addresses(o.queued.toAddr)), norm(mail.to)) || !same(norm(addresses(o.queued.ccAddr)), norm(mail.cc)))) {
    reasons.push("the draft changed in Mail after it was queued: cancel and queue it again");
  }
  return out({ project, mail, ...(config ? { config } : {}) });
}

export type { DraftRow };
