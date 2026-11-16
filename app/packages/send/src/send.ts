import { createHash } from "node:crypto";
import { markerLeft, unresolvedMarkers } from "@hub/config";
import { RepoError, type DraftRow, type Repos, type SendRow } from "@hub/db";
import { checkDraftRecipients, loadProject, loadProjects, normalizeAddress, type ProjectConfig } from "@hub/projects";
import { bareId, type MailDraft, type Mailer } from "./mailer.js";

// `hub send` (decision 0011, plan P23). The only code that sends mail. Every send, manual or automatic, goes through
// `assess` first: the same refusals for both, strictest for autosend. Nothing here is reachable from an agent session.

export interface SendDeps {
  repos: Repos;
  mailer: Mailer;
  projectsDir: string;
  /** `allow_list` of config/config.json: what `draft.recipients: test` means. */
  allowList: string[];
  now?: () => Date;
}

export type SendMode = "manual" | "auto";

export interface Assessment {
  ok: boolean;
  reasons: string[];
  draftId: number;
  project?: string;
  mail?: MailDraft;
  config?: ProjectConfig;
}

const ADDRESS = /[^\s,;<>"']+@[^\s,;<>"']+/g;
const addresses = (v: string | null | undefined): string[] => (v?.match(ADDRESS) ?? []).map(normalizeAddress);
const norm = (list: string[]): string[] => [...new Set(list.map(normalizeAddress))].sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const DAY_MS = 86_400_000;

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
  if (draft.injectionSuspected) reasons.push("the mail it answers was flagged injection_suspected: never sent by the hub");
  if (client.marks.includes("do_not_contact")) reasons.push("the client is marked do_not_contact");

  let config: ProjectConfig | undefined;
  try {
    config = loadProject(deps.projectsDir, project).parsed.config;
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
  const found = await findMail(deps, draft);
  if (!found.mail) {
    reasons.push(found.reason);
    return out({ project, ...(config ? { config } : {}) });
  }
  const mail = found.mail;

  if (config) {
    const accounts = config.mail.accounts.map((a) => a.trim().toLowerCase());
    if (!mail.account || !accounts.includes(mail.account.trim().toLowerCase())) reasons.push(`the draft sits in account "${mail.account ?? "?"}", not one of ${project}'s (${config.mail.accounts.join(", ") || "none"})`);
    const from = addresses(mail.sender)[0];
    if (!from) reasons.push("the draft has no sender");
    else if (config.mail.sender && from !== normalizeAddress(config.mail.sender)) reasons.push(`the draft's sender ${from} is not mail.sender (${config.mail.sender})`);
    const everyone = [...mail.to, ...mail.cc, ...mail.bcc];
    const g = checkDraftRecipients(config, everyone, deps.allowList);
    if (!g.ok) reasons.push(`draft.recipients of ${project} does not permit ${g.blocked.join(", ")}`);
  }
  if (mail.to.length === 0) reasons.push("the draft has no To recipient");
  if (mail.attachments > 0) reasons.push(`the draft has ${mail.attachments} attachment(s): the hub sends plain text only`);
  if (!mail.body.trim()) reasons.push("the draft text is empty");
  const left = unresolvedMarkers(`${mail.subject}\n${mail.body}`);
  if (left.length) reasons.push(`a placeholder is left in the text: ${left[0]}`);
  if (markerLeft(`${mail.subject}\n${mail.body}`)) reasons.push("the first line `[hub-draft ...]` is still in the text: delete it");

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

export type MailFound = { mail: MailDraft; reason?: undefined } | { mail?: undefined; reason: string };

/** The one Mail draft a hub draft stands for, found by Message-ID first and by recipient and subject after. Read-only. */
export async function findMail(deps: Pick<SendDeps, "mailer">, draft: Pick<DraftRow, "mailRef" | "subject" | "toAddr">): Promise<MailFound> {
  let candidates: MailDraft[] = [];
  try {
    candidates = await deps.mailer.findDrafts({ mailRef: draft.mailRef, subject: draft.subject });
  } catch (e) {
    return { reason: `Mail could not be read: ${(e as Error).message}` };
  }
  const ref = bareId(draft.mailRef);
  const byId = ref ? candidates.filter((c) => c.messageId === ref) : [];
  const toAddr = addresses(draft.toAddr);
  const pool = byId.length ? byId : candidates.filter((c) => toAddr.every((a) => norm(c.to).includes(a)));
  if (pool.length === 0) return { reason: `no draft in Mail with subject "${draft.subject}" for ${draft.toAddr}` };
  if (pool.length > 1) return { reason: `${pool.length} drafts in Mail match subject "${draft.subject}" for ${draft.toAddr}: delete the extras` };
  return { mail: pool[0] as MailDraft };
}

/** Fingerprint of what would go out: subject, recipients, text. What Checked is bound to; the text itself is never kept. */
export function mailHash(m: Pick<MailDraft, "subject" | "to" | "cc" | "bcc" | "body">): string {
  return createHash("sha256").update(JSON.stringify([m.subject, norm(m.to), norm(m.cc), norm(m.bcc), m.body])).digest("hex");
}

export type SendOutcome = { code: 0 | 1 | 2; line: string };
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const refuse = (draftId: number, reasons: string[]): SendOutcome => ({ code: 2, line: line({ ok: false, draftId, refused: reasons }) });
const fields = (m: MailDraft) => ({ from: m.sender, to: m.to, cc: m.cc, subject: m.subject });

/**
 * `hub send <draftId>`. `confirm` (the server's Send) is the recipient and subject the person saw; a mismatch refuses. Dry run unless `apply`: it reads Mail and prints what it would send (full text included). With
 * `apply` it writes the audit row first, sends, and finishes the row. Exit codes as `record-draft`: 0 ok, 1 failure
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
  return deliver(deps, { draftId: o.draftId, project: a.project, mode: "manual", actor: o.actor, mail: m });
}

async function deliver(deps: SendDeps, o: { draftId: number; project: string; mode: SendMode; actor: string; mail: MailDraft; queued?: SendRow }): Promise<SendOutcome> {
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
    sent = await deps.mailer.send(m);
  } catch (e) {
    await deps.repos.sends.markFailed(row.id, (e as Error).message);
    return { code: 1, line: line({ ok: false, draftId: o.draftId, sendId: row.id, error: `not sent: ${(e as Error).message}` }) };
  }
  try {
    await deps.repos.sends.markSent(row.id, sent.messageId);
  } catch (e) {
    return { code: 1, line: line({ ok: false, draftId: o.draftId, sendId: row.id, error: `the mail WAS sent but its log row could not be finished (${(e as Error).message}); send ${row.id} stays "sending"` }) };
  }
  return { code: 0, line: line({ ok: true, sent: true, draftId: o.draftId, sendId: row.id, ...fields(m) }) };
}

export interface DueReport {
  /** Rows sent (or that would be, in a dry run) because their window is over. */
  sent: Array<{ sendId: number; draftId: number }>;
  /** Drafts queued now (or that would be). */
  queued: Array<{ draftId: number; dueAt: string }>;
  /** Queued rows cancelled because a check no longer held. */
  cancelled: Array<{ sendId: number; draftId: number | null; reasons: string[] }>;
  /** Drafts looked at and left alone, with why. */
  skipped: Array<{ draftId: number; reasons: string[] }>;
  failed: Array<{ sendId: number; error: string }>;
  stopped: string[];
}

/**
 * `hub send --due`. Off unless a project has `send.mode: auto` and is active. Phase 1 sends the queued rows whose
 * window is over, after re-reading Mail and re-running every check (a changed draft, a hold, a Stop all or a changed
 * project setting cancels the row). Phase 2 queues the ready drafts of the listed classes under the daily cap, each
 * due after `send.delay_minutes`. A dry run reads and decides but writes nothing and sends nothing.
 */
export async function runDue(deps: SendDeps, o: { apply: boolean; project?: string; actor?: string }): Promise<{ code: 0 | 1; report: DueReport }> {
  const now = deps.now?.() ?? new Date();
  const actor = o.actor ?? "auto";
  const report: DueReport = { sent: [], queued: [], cancelled: [], skipped: [], failed: [], stopped: await deps.repos.sends.stoppedScopes() };
  let code: 0 | 1 = 0;

  // Phase 1: rows whose window is over.
  for (const row of await deps.repos.sends.due(now.toISOString(), o.project)) {
    const a = await assess(deps, row.draftId ?? -1, { mode: "auto", queued: row });
    if (!a.ok || !a.mail) {
      if (o.apply) await deps.repos.sends.cancel(row.id, `checks failed at send time: ${a.reasons.join("; ")}`.slice(0, 1000));
      report.cancelled.push({ sendId: row.id, draftId: row.draftId, reasons: a.reasons });
      continue;
    }
    if (!o.apply) {
      report.sent.push({ sendId: row.id, draftId: row.draftId as number });
      continue;
    }
    const claimed = await deps.repos.sends.claim(row.id);
    if (!claimed) continue; // cancelled meanwhile, or another runner has it
    const r = await deliver(deps, { draftId: row.draftId as number, project: row.project, mode: "auto", actor, mail: a.mail, queued: claimed });
    if (r.code === 0) report.sent.push({ sendId: row.id, draftId: row.draftId as number });
    else {
      code = 1;
      report.failed.push({ sendId: row.id, error: (JSON.parse(r.line) as { error?: string }).error ?? "failed" });
    }
  }

  // Phase 2: queue new ones.
  for (const p of loadProjects(deps.projectsDir)) {
    const c = p.parsed.config;
    if (o.project && p.slug !== o.project) continue;
    if (c.send.mode !== "auto" || c.status !== "active" || c.send.classes.length === 0) continue;
    if (await deps.repos.sends.isStopped(p.slug)) continue;
    let room = c.send.dailyCap - (await deps.repos.sends.autoCountSince(p.slug, new Date(now.getTime() - DAY_MS).toISOString()));
    const ready = await deps.repos.sends.readyOfClasses(p.slug, c.send.classes);
    for (const d of ready) {
      if (room <= 0) break;
      const a = await assess(deps, d.id, { mode: "auto", checkCap: false });
      if (!a.ok || !a.mail) {
        // Not eligible: say why only when something other than "already queued/sent" is in the way.
        if (!a.reasons.every((r) => /^(already (queued|sent)|an earlier autosend)/.test(r))) report.skipped.push({ draftId: d.id, reasons: a.reasons });
        continue;
      }
      const dueAt = new Date(now.getTime() + c.send.delayMinutes * 60_000).toISOString();
      if (o.apply) {
        try {
          const m = a.mail;
          await deps.repos.sends.begin({ project: p.slug, draftId: d.id, mode: "auto", status: "queued", actor, at: now.toISOString(), dueAt, sender: m.sender, to: m.to.join(", "), cc: m.cc.join(", ") || null, bcc: null, subject: m.subject, body: m.body, mailRef: m.messageId });
        } catch (e) {
          if (e instanceof RepoError) continue;
          throw e;
        }
      }
      room--;
      report.queued.push({ draftId: d.id, dueAt });
    }
  }
  return { code, report };
}

export type { DraftRow };
