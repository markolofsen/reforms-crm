import { offMode } from "@hub/config/modes";
import type { DraftRow, Repos } from "@hub/db";
import { osaFor, type OsaRun } from "@hub/mail-app/osa";
import { mailRunning, readSent, type SentMessage } from "@hub/mail-app/read";
import { bareId } from "@hub/mail-app/records";
import type { SentNotice } from "@hub/send";
import type { ProjectStore } from "@hub/projects/store";
import { errFields, ops } from "@hub/log/ops";

/**
 * Sent detection (decision 0026). A draft becomes `sent` only when its message shows up in the Sent mailbox of one of
 * the project's Apple Mail accounts: the hub never treats a keypress as proof. Each pass reads only while a draft waits,
 * and only since the oldest waiting draft (minus a day); it never launches Mail. A draft is matched only by its own recorded
 * Message-IDs (P90); a reply in its thread that is not the Hub's is noted on the draft (`drafts.markElsewhere`), never marked.
 * A follow-up step found here advances its enrollment through `drafts.markSent`, the one writer of `sent`. With a Notion
 * reader, each pass also refreshes the clients' `Last sent` stamps written by other people (P90, personal mailboxes).
 */
export interface SentStatus {
  state: "off" | "starting" | "running" | "error" | "stopped";
  reason?: string;
  /** Projects read on the last pass. */
  projects: string[];
  lastRunAt?: string;
  lastError?: string;
  failures: number;
  /** Drafts marked sent since the server started. */
  marked: number;
}

export const SENT_OFF: SentStatus = { state: "off", reason: "not started", projects: [], failures: 0, marked: 0 };

export interface SentHandle {
  status(): SentStatus;
  /** One pass now (tests, and the first pass at start). */
  tick(): Promise<void>;
  stop(): void;
}

export interface SentOptions {
  repos: Repos;
  /** P126 P3: each project's Mail accounts and Sent mailbox, read from project.md. */
  projects: ProjectStore;
  /** Default: the real `osascript`. Tests pass a fake; nothing in a test reaches Mail. */
  osa?: OsaRun;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Set when the loop must not read Mail at all (the fake Mailer): the reason health shows. */
  offReason?: string;
  /** Between passes. Default 5 minutes (HUB_SENT_INTERVAL_MS). Doubles after each failed pass, up to one hour. */
  intervalMs?: number;
  /** How far back a draft can still be matched. Default 30 days. */
  lookbackDays?: number;
  /** Set false in tests that call `tick()` themselves. */
  timer?: boolean;
  /** P89: told for each draft this loop marks sent (the Notion stamp of who sent); never awaited for the pass, never trusted. */
  onSent?: (n: SentNotice) => void;
  /** P90: reads the client's Notion `Last sent at` / `Last sent by` written by another person; absent, the card shows no Notion line. */
  teamStamp?: TeamStampReader;
}

const DAY = 86_400_000;
/** P90: a client's Notion stamp is read at most this often per open draft. */
const TEAM_EVERY_MS = 30 * 60_000;

export type SentVia = "message-id";
export interface SentMatch { draftId: number; via: SentVia; sent: SentMessage }
/** A draft that waits, and the Message-IDs of the Mail versions the Hub recorded for it (P65), bare. */
type Waiting = Pick<DraftRow, "id" | "mailRef" | "createdAt"> & { versions?: readonly string[] };

const firstTo = (to: string): string | null => {
  for (const part of to.split(",")) {
    const a = (/<([^>]+)>/.exec(part)?.[1] ?? part).trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+$/.test(a)) return a;
  }
  return null;
};

/**
 * Which Sent messages are which drafts (P90): only by the draft's own Message-IDs, the Mail versions this Hub recorded for
 * it (every version, trashed or not; Mail keeps a draft's Message-ID when the owner sends it from Mail, measured 2026-11-19/20).
 * The Hub's own door is different (P96, measured 2026-11-20): its send gets a NEW Message-ID, which the door does not learn;
 * the Mail reader reads it back from Sent into `send_log.sent_message_id` and `drafts.sent_message_id` (`inbound.ts`), so it
 * is in `taken` here and never reads as a reply by someone else.
 * Never by thread or subject: in a mailbox two people share, a reply in the thread proves only that someone answered
 * (that is `elsewhereOf`). Never the `mailRef`: that is the message the draft ANSWERS (decision 0031 point 2). A sent
 * message satisfies one draft only, and one already attributed to a finished draft (`taken`) is no one's.
 */
export function matchSent(drafts: Waiting[], sent: SentMessage[], taken: readonly string[] = []): SentMatch[] {
  const gone = new Set(taken.map(bareId).filter(Boolean));
  const pool = sent.filter((m) => !gone.has(bareId(m.messageId)));
  const queue = [...drafts].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id));
  const used = new Set<string>();
  const out: SentMatch[] = [];
  for (const d of queue) {
    const own = new Set((d.versions ?? []).map(bareId).filter(Boolean));
    const hit = own.size ? pool.find((m) => !used.has(m.messageId) && own.has(m.messageId)) : undefined;
    if (!hit) continue;
    used.add(hit.messageId);
    out.push({ draftId: d.id, via: "message-id", sent: hit });
  }
  return out;
}

export interface ElsewhereMatch { draftId: number; sent: SentMessage }

/**
 * P90: for each waiting draft, the newest Sent message that answers its thread (In-Reply-To or References names its
 * `mailRef`) and is not the Hub's: its Message-ID is none of `ours` (every version the project recorded, every Message-ID a
 * draft was marked sent with) and is not the `mailRef` itself. A teammate in a shared mailbox, or the owner from another
 * device (or a hand send whose id Mail changed). Informational only.
 */
export function elsewhereOf(drafts: Waiting[], sent: SentMessage[], ours: readonly string[]): ElsewhereMatch[] {
  const mine = new Set(ours.map(bareId).filter(Boolean));
  const out: ElsewhereMatch[] = [];
  for (const d of drafts) {
    const ref = bareId(d.mailRef);
    if (!ref) continue;
    const hits = sent.filter((m) => m.messageId !== ref && !mine.has(m.messageId) && (m.inReplyTo === ref || m.references.includes(ref)));
    const newest = hits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
    if (newest) out.push({ draftId: d.id, sent: newest });
  }
  return out;
}

export interface ProjectPlan {
  slug: string;
  accounts: string[];
  mailbox: string;
  waiting: Array<DraftRow & { versions?: readonly string[] }>;
  taken?: readonly string[];
  /** P90: every Message-ID of the project's recorded versions (any draft): a Sent message with one of them is the Hub's. */
  ours?: readonly string[];
}

/** One project: read each account's Sent since the oldest waiting draft minus a day, match, mark, note replies elsewhere. Errors are per account. */
export async function reconcileProject(osa: OsaRun, repos: Repos, p: ProjectPlan, onSent?: (n: SentNotice) => void): Promise<{ marked: number; elsewhere: number; errors: string[] }> {
  const oldest = p.waiting.reduce((m, d) => (d.createdAt < m ? d.createdAt : m), p.waiting[0]!.createdAt);
  const from = new Date(Date.parse(oldest) - DAY);
  const sent: SentMessage[] = [];
  const errors: string[] = [];
  for (const account of p.accounts) {
    try {
      sent.push(...(await readSent(osa, account, p.mailbox, from)));
    } catch (e) {
      errors.push(`${p.slug} / ${account}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      ops("mail").warn("reading Sent for sent detection failed", { project: p.slug, account, ...errFields(e) });
    }
  }
  let marked = 0;
  const matched = matchSent(p.waiting, sent, p.taken ?? []);
  for (const m of matched) {
    const d = await repos.drafts.markSent(m.draftId, { at: m.sent.date, via: m.via, messageId: m.sent.messageId });
    if (d?.status === "sent") {
      marked++;
      try { onSent?.({ project: p.slug, draftId: m.draftId, to: [d.toAddr], at: m.sent.date, via: m.via }); } catch { /* a notice never stops the pass */ }
    }
  }
  const done = new Set(matched.map((m) => m.draftId));
  const ours = [...(p.ours ?? []), ...(p.taken ?? []), ...p.waiting.flatMap((d) => d.versions ?? []), ...matched.map((m) => m.sent.messageId)];
  let elsewhere = 0;
  for (const e of elsewhereOf(p.waiting.filter((d) => !done.has(d.id)), sent, ours)) {
    if (await repos.drafts.markElsewhere(e.draftId, { at: e.sent.date, from: e.sent.from || e.sent.account, messageId: e.sent.messageId })) elsewhere++;
  }
  return { marked, elsewhere, errors };
}

/** Active projects that list a Mail account and have drafts waiting. Reads SQLite only. */
async function plans(repos: Repos, projects: ProjectStore, since: string): Promise<ProjectPlan[]> {
  const out: ProjectPlan[] = [];
  for (const row of (await repos.projects.registry()).projects) {
    if (row.status !== "active" || row.archived) continue;
    const c = projects.find(row.slug);
    if (!c || c.mail.accounts.length === 0) continue;
    const drafts = await repos.drafts.awaitingSent(row.slug, since);
    if (!drafts.length) continue;
    const all = await repos.mailVersions.ofProject(row.slug);
    const versions = new Map<number, string[]>();
    for (const v of all) if (v.draftId !== null) versions.set(v.draftId, [...(versions.get(v.draftId) ?? []), v.messageId]);
    out.push({ slug: row.slug, accounts: c.mail.accounts, mailbox: c.mail.sentMailbox, waiting: drafts.map((d) => ({ ...d, versions: versions.get(d.id) ?? [] })), taken: await repos.drafts.sentMessageIds(row.slug, since), ours: all.map((v) => v.messageId) });
  }
  return out;
}

/**
 * P90: the client's Notion stamp for each open draft (personal mailboxes: Notion is the only cross-person truth), at most
 * once per `TEAM_EVERY_MS` per draft. Runs whether Mail is open or not. A failure is the reader's ops-log line, never the pass's.
 */
async function refreshTeamStamps(repos: Repos, todo: ProjectPlan[], read: TeamStampReader, seen: Map<number, number>, nowMs: number): Promise<void> {
  for (const p of todo) {
    for (const d of p.waiting) {
      if (nowMs - (seen.get(d.id) ?? -Infinity) < TEAM_EVERY_MS) continue;
      seen.set(d.id, nowMs);
      const email = firstTo(d.toAddr);
      if (!email) continue;
      const stamp = await read(p.slug, email).catch(() => undefined);
      if (stamp !== undefined) await repos.clients.setTeamSent(d.clientId, stamp);
    }
  }
}

/** Another person's Notion stamp on a client (null: none, or this Mac's own); `undefined` from a rejection means "unknown, keep what is stored". */
export type TeamStampReader = (project: string, email: string) => Promise<{ at: string; by: string } | null>;

export function startSentReconciler(o: SentOptions): SentHandle {
  const env = o.env ?? process.env;
  const osa = o.osa ?? osaFor("long");
  const now = o.now ?? (() => new Date());
  const disabled = o.offReason ?? (offMode(env, "sent") === "off" ? "HUB_SENT=off" : undefined);
  const base = o.intervalMs ?? (Number(env.HUB_SENT_INTERVAL_MS) || 5 * 60_000);
  const st: SentStatus = { state: disabled ? "off" : "starting", ...(disabled ? { reason: disabled } : {}), projects: [], failures: 0, marked: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running: Promise<void> | undefined;
  const teamSeen = new Map<number, number>();

  const off = (reason: string) => {
    st.state = "off";
    st.reason = reason;
    st.projects = [];
    st.failures = 0;
    delete st.lastError;
  };

  async function pass(): Promise<void> {
    if (disabled) return;
    const todo = await plans(o.repos, o.projects, new Date(now().getTime() - (o.lookbackDays ?? 30) * DAY).toISOString());
    // No draft waits: Mail is not asked anything.
    if (todo.length === 0) return off("no draft waits to be seen in Sent");
    if (o.teamStamp) await refreshTeamStamps(o.repos, todo, o.teamStamp, teamSeen, now().getTime()).catch((e: unknown) => ops("notion").warn("refreshing the clients' Last sent stamps failed", errFields(e)));
    if (!(await mailRunning(osa).catch(() => false))) return off("Mail is not running");
    const errors: string[] = [];
    for (const p of todo) {
      const r = await reconcileProject(osa, o.repos, p, o.onSent);
      st.marked += r.marked;
      errors.push(...r.errors);
    }
    delete st.reason;
    st.projects = todo.map((p) => p.slug);
    st.lastRunAt = now().toISOString();
    if (errors.length) {
      st.state = "error";
      st.failures++;
      st.lastError = errors.join("; ").slice(0, 400);
    } else {
      st.state = "running";
      st.failures = 0;
      delete st.lastError;
    }
  }

  const tick = () => (running ??= pass().finally(() => (running = undefined)));
  const schedule = () => {
    if (stopped || o.timer === false || disabled) return;
    timer = setTimeout(() => void tick().finally(schedule), Math.min(base * 2 ** Math.min(st.failures, 6), 3_600_000));
    timer.unref?.();
  };
  if (!disabled && o.timer !== false) void tick().finally(schedule);

  return {
    status: () => ({ ...st, projects: [...st.projects] }),
    tick,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (st.state !== "off") st.state = "stopped";
    },
  };
}
