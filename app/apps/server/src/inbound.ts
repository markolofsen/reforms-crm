import { offMode } from "@hub/config/modes";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAIL_NOT_RUNNING, MAIL_UNREADABLE } from "@hub/contract/inbound";
import { PREVIEW_CHARS, type InboundKnown, type NewInbound, type Repos } from "@hub/db";
import { classifyMessage, parseRulesFile, type RulesFile } from "@hub/mail-filters";
import { isOwnAddress } from "@hub/projects/brand";
import { projectStore, readAllowList, testRecipientsOf } from "@hub/projects";
import type { ProjectConfig } from "@hub/projects/model";
import { osaFor, type OsaRun } from "@hub/mail-app/osa";
import { bareId } from "@hub/mail-app/records";
import { errFields, ops } from "@hub/log/ops";
import { mailRunning, previewOf, readInbound, readMessageText, readSent, type ReceivedMessage } from "@hub/mail-app/read";

/**
 * The Mail reader (P96 S1, verdicts 1 to 4, 12, 13). The server reads each active project's inbound mailboxes in Apple Mail,
 * read-only, as Sent detection reads Sent (decision 0026): `mail.mailboxes` (default INBOX) and the `hub/client` and
 * `hub/partner` labels where the project's filters may have moved client mail. It keeps only the messages it judges a
 * client's, by strict rules and no model (`judge`), with at most 120 characters of the client's own text; the rest is counted
 * ("2 messages from senders the Hub does not know") or ignored (machines, our own mail, the filters' service classes). It
 * never launches Mail, never writes to it, never starts an agent. Every 2 minutes while the admin is open or a terminal
 * session runs, else every 15; "Check now" runs a pass at once. Each pass also reads back the Message-ID Mail gave each send
 * of the Hub's door (verdict 13: Mail assigns a new one at send), so a client's reply to it is matched by our own id.
 */
export interface InboundProjectStatus {
  slug: string;
  /** When this project's mailboxes were last read without an error. */
  readAt: string | null;
  /** Messages in the window from people the Hub does not know (not machines, not filtered): triage's job, one muted line. */
  unknown: number;
  /** P97: messages in the window that are a site's notification of a lead (the lead itself is listed from Notion Leads). */
  notices?: number;
  error?: string;
}

export interface InboundStatus {
  state: "off" | "starting" | "running" | "error" | "stopped";
  reason?: string;
  projects: InboundProjectStatus[];
  lastRunAt?: string;
  lastError?: string;
  failures: number;
  /** Rows stored since the server started. */
  stored: number;
  /** A pass is running now (the admin says "Reading Mail…"). */
  reading: boolean;
}

export const INBOUND_OFF: InboundStatus = { state: "off", reason: "The Mail reader is not running", projects: [], failures: 0, stored: 0, reading: false };

export interface InboundHandle {
  status(): InboundStatus;
  /** One pass now; a pass already running is the one awaited (Check now, tests). */
  tick(): Promise<void>;
  stop(): void;
}

/** A Notion client the server already holds in memory (the client directory, P84), by project and address. */
export type KnownClient = (project: string, email: string) => boolean;

export interface InboundOptions {
  repos: Repos;
  osa?: OsaRun;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Set when the reader must not read Mail at all (the fake Mailer): the reason health shows. */
  offReason?: string;
  /** The projects' folders (project.md, mail-filters.md) and the send policies (`draft.recipients`). */
  projectsDir: string;
  policyDir?: string;
  /** `config/config.json`: its `allow_list` is who a test-mode project writes to. */
  configFile: string;
  knownClient?: KnownClient;
  /** True while the admin is open or a terminal session runs: then every `activeMs`, else every `idleMs`. */
  busy?: () => boolean;
  activeMs?: number;
  idleMs?: number;
  timer?: boolean;
  /** Told after a pass stored rows for a project (the live topic moves with the rows themselves; this is for tests). */
  onStored?: (project: string, n: number) => void;
  /** P97: told when a pass sees a lead notice it had not seen before (after the project's first pass): the Leads reader reads at once. */
  onNotice?: (project: string) => void;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The first pass reads this far back; later passes from the last good read minus an hour (verdict 1). */
const FIRST_WINDOW_MS = 3 * DAY;
/** The labels the project's filters may move client mail to (skill triage-mail section 1); a missing one is skipped. */
export const LABEL_MAILBOXES = ["hub/client", "hub/partner"] as const;
/** The filters' classes that are never a client writing (counted by triage, never read). */
const NOT_A_CLIENT = new Set(["service", "marketing", "cold-outreach", "spam"]);
/** An address that is a machine's by its local part (Cloudflare, DMARC reports, OpenAI, a site's robot). */
const MACHINE = /^(no-?reply|do-?not-?reply|noreply-[\w.-]+|[\w.-]*-noreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|dmarc[\w.-]*|robot|daemon)(\+[^@]*)?@/i;

export type Verdict =
  | { kind: "client"; why: "thread" | "client" | "test"; threadRef: string | null; threadDraftId: number | null }
  | { kind: "unknown" }
  | { kind: "ignored"; reason: "own" | "machine" | "filtered" | "do_not_contact" | "lead_notice" };

export interface JudgeContext {
  /** `leads.noticeSenders` (P97): the project's lead-notice senders, normalised; absent: none. */
  config: Pick<ProjectConfig, "mail"> & { leads?: { noticeSenders: readonly string[] } };
  known: InboundKnown;
  rules: RulesFile | null;
  /** The owner's test addresses when the project is in test mode, else empty. */
  testAddresses: ReadonlySet<string>;
  knownClient: (email: string) => boolean;
}

/**
 * Verdict 3, strict and without a model: a client wrote when (a) the message answers one of ours (In-Reply-To or References
 * names a message our draft answered, a Mail version the Hub wrote, or what the door sent), (b) the sender is a client the
 * Hub knows (a `clients` row or the Notion directory) or the filters whitelist them, or (c) the project is in test mode and
 * the sender is on `allow_list`. Never our own addresses, a filtered service, marketing, cold-outreach or spam sender, a
 * machine (bulk headers, a no-reply address), or a client marked Do not contact. Anyone else is `unknown`.
 */
export function judge(m: Pick<ReceivedMessage, "email" | "subject" | "inReplyTo" | "references" | "bulk">, c: JudgeContext): Verdict {
  const email = m.email.trim().toLowerCase();
  if (isOwnAddress(email, c.config.mail)) return { kind: "ignored", reason: "own" };
  const filed = c.rules ? classifyMessage(c.rules, { from: email, subject: m.subject }) : null;
  const whitelisted = filed?.category === "client";
  if (isLeadNotice(email, c.config.leads?.noticeSenders ?? [], whitelisted)) return { kind: "ignored", reason: "lead_notice" };
  if (!whitelisted && filed && NOT_A_CLIENT.has(filed.category)) return { kind: "ignored", reason: "filtered" };
  if (c.known.doNotContact.has(email)) return { kind: "ignored", reason: "do_not_contact" };
  if (!whitelisted && (m.bulk || MACHINE.test(email))) return { kind: "ignored", reason: "machine" };
  for (const ref of [m.inReplyTo, ...m.references]) {
    const k = bareId(ref);
    if (k && c.known.ours.has(k)) return { kind: "client", why: "thread", threadRef: k, threadDraftId: c.known.ours.get(k) ?? null };
  }
  if (whitelisted || c.known.clients.has(email) || c.knownClient(email)) return { kind: "client", why: "client", threadRef: null, threadDraftId: null };
  if (c.testAddresses.has(email)) return { kind: "client", why: "test", threadRef: null, threadDraftId: null };
  return { kind: "unknown" };
}

/**
 * P97 verdict 1 (decision 0044 point 1): a site's notification of a lead is never a person writing. A sender on the project's
 * `leads.notice_senders`, or a machine address the mail filters whitelist (the owner keeps `robot@…` visible in Mail, which
 * made it an Inbox client row), is a lead notice. A machine the filters do not whitelist stays `machine`, as before.
 */
export function isLeadNotice(email: string, noticeSenders: readonly string[], whitelisted: boolean): boolean {
  const e = email.trim().toLowerCase();
  return noticeSenders.includes(e) || (whitelisted && MACHINE.test(e));
}

/** A stored Inbox row whose sender is a lead notice by its address alone (the re-judge of rows stored before P97: a stored machine sender was whitelisted). */
export const storedRowIsNotice = (email: string, noticeSenders: readonly string[]): boolean => isLeadNotice(email, noticeSenders, true);

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const normSubject = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const firstAddress = (to: string): string => lower(/[^\s,;<>"']+@[^\s,;<>"']+/.exec(to)?.[0]);

interface Plan {
  slug: string;
  config: ProjectConfig;
  rules: RulesFile | null;
  testAddresses: Set<string>;
}

function rulesOf(projectsDir: string, slug: string): RulesFile | null {
  const file = join(projectsDir, slug, "mail-filters.md");
  if (!existsSync(file)) return null;
  try {
    return parseRulesFile(readFileSync(file, "utf8")).file;
  } catch {
    return null;
  }
}

export function startInboundReader(o: InboundOptions): InboundHandle {
  const env = o.env ?? process.env;
  const osa = o.osa ?? osaFor("long");
  const now = o.now ?? (() => new Date());
  const disabled = o.offReason ?? (offMode(env, "inbound") === "off" ? "The Mail reader is off (HUB_INBOUND=off)" : undefined);
  const activeMs = o.activeMs ?? (Number(env.HUB_INBOUND_ACTIVE_MS) || 2 * 60_000);
  const idleMs = o.idleMs ?? (Number(env.HUB_INBOUND_IDLE_MS) || 15 * 60_000);
  const st: InboundStatus = { state: disabled ? "off" : "starting", ...(disabled ? { reason: disabled } : {}), projects: [], failures: 0, stored: 0, reading: false };
  /** Per project: the last good read (the next window starts an hour before it). */
  const lastGood = new Map<string, number>();
  /** Per project: the lead notices seen so far (P97: a new one makes the Leads reader read at once). Memory only. */
  const noticeIds = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running: Promise<void> | undefined;

  const off = (reason: string) => {
    st.state = "off";
    st.reason = reason;
    st.failures = 0;
    delete st.lastError;
  };

  async function plans(): Promise<Plan[]> {
    const allow = readAllowList(o.configFile);
    const out: Plan[] = [];
    for (const row of (await o.repos.projects.registry()).projects) {
      if (row.status !== "active" || row.archived || row.slug.startsWith("_")) continue;
      let config: ProjectConfig;
      try {
        config = projectStore({ projects: o.projectsDir, ...(o.policyDir ? { stateProjects: o.policyDir } : {}) }).config(row.slug);
      } catch {
        continue;
      }
      if (config.mail.accounts.length === 0) continue;
      out.push({ slug: row.slug, config, rules: rulesOf(o.projectsDir, row.slug), testAddresses: new Set(testRecipientsOf(config, allow)) });
    }
    return out;
  }

  /** One project: read its mailboxes, judge, read the text of the new client messages only, store. */
  async function readProject(p: Plan): Promise<InboundProjectStatus> {
    const t = now().getTime();
    const since = new Date((lastGood.has(p.slug) ? (lastGood.get(p.slug) as number) - HOUR : t - FIRST_WINDOW_MS));
    const known = await o.repos.inboundMail.known(p.slug);
    const ctx: JudgeContext = { config: p.config, known, rules: p.rules, testAddresses: p.testAddresses, knownClient: (e) => o.knownClient?.(p.slug, e) ?? false };
    const errors: string[] = [];
    const seen = new Map<string, ReceivedMessage>();
    for (const account of p.config.mail.accounts) {
      for (const mailbox of [...new Set([...p.config.mail.mailboxes, ...LABEL_MAILBOXES])]) {
        try {
          for (const m of (await readInbound(osa, account, mailbox, since)) ?? []) if (!seen.has(m.messageId)) seen.set(m.messageId, m);
        } catch (e) {
          errors.push(`${account} / ${mailbox}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
          ops("mail").warn("reading a mailbox for the Mail reader failed", { project: p.slug, account, mailbox, ...errFields(e) });
        }
      }
    }
    const msgs = [...seen.values()];
    const stored = await o.repos.inboundMail.storedIds(p.slug, msgs.map((m) => m.messageId));
    const rows: NewInbound[] = [];
    let unknown = 0;
    let notices = 0;
    const firstPass = !noticeIds.has(p.slug);
    const seenNotices = noticeIds.get(p.slug) ?? new Set<string>();
    noticeIds.set(p.slug, seenNotices);
    let freshNotice = false;
    for (const m of msgs) {
      const v = judge(m, ctx);
      if (v.kind === "unknown") unknown++;
      if (v.kind === "ignored" && v.reason === "lead_notice") {
        notices++;
        if (!firstPass && !seenNotices.has(m.messageId)) freshNotice = true;
        seenNotices.add(m.messageId);
      }
      if (v.kind !== "client") continue;
      // A stored row gets its read flag only: its text is not read again.
      let preview = "";
      if (!stored.has(m.messageId)) {
        try {
          preview = previewOf((await readMessageText(osa, m.account, m.mailbox, m.mailId)) ?? "", PREVIEW_CHARS);
        } catch (e) {
          ops("mail").warn("reading a client message's text for its preview failed", { project: p.slug, account: m.account, ...errFields(e) });
        }
      }
      rows.push({ project: p.slug, account: m.account, mailbox: m.mailbox, messageId: m.messageId, email: m.email, name: m.name || m.email, subject: m.subject, receivedAt: m.receivedAt, read: m.read, why: v.why, threadDraftId: v.threadDraftId, threadRef: v.threadRef, preview });
    }
    const added = await o.repos.inboundMail.store(rows, now());
    st.stored += added;
    if (added) o.onStored?.(p.slug, added);
    // P97 S1: rows stored before a sender was known as a lead notice leave Inbox, re-judged by their address (reason lead_notice).
    const senders = p.config.leads.noticeSenders;
    const cleared = await o.repos.inboundMail.dismissWhere(p.slug, (email) => storedRowIsNotice(email, senders), "lead_notice", now());
    if (cleared.length) ops("mail").info("lead notices left Inbox (re-judged: a notification of a lead is not a client)", { project: p.slug, rows: cleared.length });
    if (freshNotice) o.onNotice?.(p.slug);
    // The owner may answer a client in Mail by hand: a message of ours in Sent that answers the row, or went to that client
    // after it arrived, closes it like a Hub draft does (reason answered). Read only when a row is open.
    await closeAnsweredByHand(p, since).catch((e: unknown) => ops("mail").warn("reading Sent for replies made by hand failed", { project: p.slug, ...errFields(e) }));
    await recordDoorSends(p).catch((e: unknown) => ops("mail").warn("reading back the door's sent Message-IDs failed", { project: p.slug, ...errFields(e) }));
    if (!errors.length) lastGood.set(p.slug, t);
    const prev = st.projects.find((x) => x.slug === p.slug);
    return { slug: p.slug, readAt: errors.length ? (prev?.readAt ?? null) : new Date(t).toISOString(), unknown, notices, ...(errors.length ? { error: errors.join("; ").slice(0, 300) } : {}) };
  }

  async function closeAnsweredByHand(p: Plan, since: Date): Promise<void> {
    if ((await o.repos.inboundMail.openEmails(p.slug)).length === 0) return;
    const sent = [];
    for (const account of p.config.mail.accounts) sent.push(...(await readSent(osa, account, p.config.mail.sentMailbox, since)));
    const closed = await o.repos.inboundMail.closeAnswered(p.slug, sent, now());
    if (closed.length) ops("mail").info("Inbox rows the owner answered in Mail by hand left Inbox", { project: p.slug, rows: closed.length });
  }

  /**
   * Verdict 13: a send of the Hub's door gets a new Message-ID from Mail (measured 2026-11-20); the door does not learn it.
   * Read it back from the account's Sent: the newest message after the send with the row's subject and first recipient that
   * is not already ours. Stored on the send row and its draft only where none is recorded. Sends of the last two days.
   */
  async function recordDoorSends(p: Plan): Promise<void> {
    const t = now().getTime();
    const waiting = await o.repos.sends.awaitingMessageId(p.slug, new Date(t - 2 * DAY).toISOString());
    if (!waiting.length) return;
    const oldest = Math.min(...waiting.map((w) => Date.parse(w.doneAt ?? w.createdAt)));
    const known = await o.repos.inboundMail.known(p.slug);
    const sent = [];
    for (const account of p.config.mail.accounts) sent.push(...(await readSent(osa, account, p.config.mail.sentMailbox, new Date(oldest - 10 * 60_000))));
    const used = new Set<string>();
    for (const w of waiting) {
      const at = Date.parse(w.doneAt ?? w.createdAt) - 2 * 60_000;
      const to = firstAddress(w.toAddr);
      const hit = sent
        .filter((m) => !used.has(m.messageId) && !known.ours.has(m.messageId) && Date.parse(m.date) >= at && normSubject(m.subject) === normSubject(w.subject) && (!to || m.to.includes(to)))
        .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      if (!hit) continue;
      used.add(hit.messageId);
      await o.repos.sends.setSentMessageId(w.id, hit.messageId);
    }
  }

  async function pass(): Promise<void> {
    if (disabled) return;
    const todo = await plans();
    if (todo.length === 0) return off("No Mail account is set");
    if (!(await mailRunning(osa).catch(() => false))) return off(MAIL_NOT_RUNNING);
    st.reading = true;
    try {
      const results: InboundProjectStatus[] = [];
      for (const p of todo) results.push(await readProject(p));
      delete st.reason;
      st.projects = results;
      st.lastRunAt = now().toISOString();
      const errors = results.flatMap((r) => (r.error ? [`${r.slug}: ${r.error}`] : []));
      if (errors.length) {
        st.state = "error";
        st.failures++;
        st.lastError = errors.join("; ").slice(0, 400);
      } else {
        st.state = "running";
        st.failures = 0;
        delete st.lastError;
      }
    } finally {
      st.reading = false;
    }
  }

  const tick = () =>
    (running ??= pass()
      .catch((e: unknown) => {
        st.state = "error";
        st.failures++;
        st.lastError = (e instanceof Error ? e.message : String(e)).slice(0, 400);
        ops("mail").error("a pass of the Mail reader failed", errFields(e));
      })
      .finally(() => (running = undefined)));
  // The clock looks every `activeMs` (doubled after each failed pass, up to an hour): a pass runs when the admin is open or a
  // session runs, else once `idleMs` has gone by since the last one. So opening the admin brings the next read within 2 minutes.
  let lastPassAt = 0;
  const due = () => o.busy?.() !== false || now().getTime() - lastPassAt >= idleMs;
  const schedule = () => {
    if (stopped || o.timer === false || disabled) return;
    timer = setTimeout(() => {
      if (!due()) return schedule();
      lastPassAt = now().getTime();
      void tick().finally(schedule);
    }, Math.min(activeMs * 2 ** Math.min(st.failures, 6), HOUR));
    timer.unref?.();
  };
  if (!disabled && o.timer !== false) {
    lastPassAt = now().getTime();
    void tick().finally(schedule);
  }

  return {
    status: () => ({ ...st, projects: st.projects.map((p) => ({ ...p })) }),
    tick,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (st.state !== "off") st.state = "stopped";
    },
  };
}

/** The status of one project for the admin's line: when Mail was last read for it, or why not. */
export function projectReadOf(s: InboundStatus, slug: string): { at: string | null; reason: string | null; reading: boolean; unknown: number; notices: number } {
  const p = s.projects.find((x) => x.slug === slug);
  const reason = s.state === "off" || s.state === "stopped" ? (s.reason ?? "Mail is not read") : p?.error ? MAIL_UNREADABLE : null;
  return { at: p?.readAt ?? null, reason, reading: s.reading, unknown: p?.unknown ?? 0, notices: p?.notices ?? 0 };
}
