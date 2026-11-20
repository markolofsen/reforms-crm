import { createHash } from "node:crypto";
import { unresolvedMarkers } from "@hub/config";
import { RepoError, withoutLeadingBlankLines, type DraftRow, type MailVersionRow, type Repos, type SendRow } from "@hub/db";
import { checkDraftRecipients, isOwnAddress, loadProject, loadProjects, normalizeAddress, type ProjectConfig } from "@hub/projects";
import { bareId, MAIL_NOT_ANSWERING_FIX, MailNotAnswering, type MailDraft, type Mailer, type TrashItem } from "./mailer";

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
  // P47 decision 5: a follow-up step is never sent by the hub, in any mode (reason `sequence-step`): the owner sends it from Mail.
  if (draft.enrollmentId != null) reasons.push("sequence-step: a follow-up step is sent by you from Mail, never by the hub");
  if (draft.injectionSuspected) reasons.push("the mail it answers was flagged injection_suspected: never sent by the hub");
  if (client.marks.includes("do_not_contact")) reasons.push("the client is marked do_not_contact");

  let config: ProjectConfig | undefined;
  try {
    config = loadProject(deps.projectsDir, project, { policyDir: deps.policyDir }).parsed.config;
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
  const draft = await deps.repos.drafts.get(o.draftId);
  return deliver(deps, { draftId: o.draftId, project: a.project, mode: "manual", actor: o.actor, mail: m, mailRef: draft?.mailRef ?? null });
}

async function deliver(deps: SendDeps, o: { draftId: number; project: string; mode: SendMode; actor: string; mail: MailDraft; queued?: SendRow; mailRef?: string | null }): Promise<SendOutcome> {
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
    const d = await deps.repos.drafts.get(row.draftId as number);
    const r = await deliver(deps, { draftId: row.draftId as number, project: row.project, mode: "auto", actor, mail: a.mail, queued: claimed, mailRef: d?.mailRef ?? null });
    if (r.code === 0) report.sent.push({ sendId: row.id, draftId: row.draftId as number });
    else {
      code = 1;
      report.failed.push({ sendId: row.id, error: (JSON.parse(r.line) as { error?: string }).error ?? "failed" });
    }
  }

  // Phase 2: queue new ones.
  for (const p of loadProjects(deps.projectsDir, { policyDir: deps.policyDir })) {
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
