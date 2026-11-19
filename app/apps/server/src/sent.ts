import type { DraftRow, Repos } from "@hub/db";
import { bareId, defaultOsa, type OsaRun } from "@hub/send";
import { mailRunning, readSent, type SentMessage } from "./apple-mail";
import { configOf } from "./overview-facts";

/**
 * Sent detection (decision 0026). A draft becomes `sent` only when its message shows up in the Sent mailbox of one of
 * the project's Apple Mail accounts: the hub never treats a keypress as proof. Each pass reads only while a draft waits,
 * and only since the oldest waiting draft (minus a day); it never launches Mail. A follow-up step found here advances its
 * enrollment through `drafts.markSent`, the one writer of `sent`.
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
}

const DAY = 86_400_000;

export type SentVia = "message-id" | "thread" | "subject-recipient";
export interface SentMatch { draftId: number; via: SentVia; sent: SentMessage }
/** A draft that waits, and the Message-IDs of the Mail versions the Hub recorded for it (P65), bare. */
type Waiting = Pick<DraftRow, "id" | "subject" | "toAddr" | "mailRef" | "createdAt"> & { versions?: readonly string[] };

/** `Re: [x] Aw: Topic` becomes `topic`. */
export function normSubject(s: string): string {
  let t = s.normalize("NFC").trim();
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/^\s*(re|fwd?|aw|wg|sv|vs|odp|ответ|отв|пересл)\s*(\[\d+\])?\s*:\s*/i, "");
  }
  return t.replace(/\s+/g, " ").toLowerCase();
}

const firstTo = (to: string): string | null => {
  for (const part of to.split(",")) {
    const a = (/<([^>]+)>/.exec(part)?.[1] ?? part).trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+$/.test(a)) return a;
  }
  return null;
};

/**
 * Which Sent messages are which drafts, by the strongest evidence first:
 *   1. `message-id`: the sent message's own Message-ID is the draft's `mailRef` or one of the Mail versions the Hub
 *      recorded for it (P65; it matches only if Mail keeps a draft's Message-ID when it sends it, which is unverified);
 *   2. `thread`: it answers the thread `mailRef` names (In-Reply-To);
 *   3. `subject-recipient`: same subject (Re:/Fwd: ignored).
 * 2 and 3 also need the draft's first recipient in To or Cc and a send after the draft was made. A sent message satisfies
 * one draft only (the oldest first), so two drafts to one client are never marked by one send. Doubt leaves a draft unmarked.
 */
export function matchSent(drafts: Waiting[], sent: SentMessage[]): SentMatch[] {
  const pool = [...sent].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.messageId < b.messageId ? -1 : 1));
  const queue = [...drafts].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id));
  const used = new Set<string>();
  const done = new Set<number>();
  const out: SentMatch[] = [];
  const take = (d: Waiting, via: SentVia, ok: (m: SentMessage) => boolean) => {
    if (done.has(d.id)) return;
    const hit = pool.find((m) => !used.has(m.messageId) && ok(m));
    if (!hit) return;
    used.add(hit.messageId);
    done.add(d.id);
    out.push({ draftId: d.id, via, sent: hit });
  };
  const fits = (d: Waiting, m: SentMessage) => {
    const r = firstTo(d.toAddr);
    return Date.parse(m.date) >= Date.parse(d.createdAt) && r !== null && [...m.to, ...m.cc].includes(r);
  };

  for (const d of queue) {
    const own = new Set([bareId(d.mailRef), ...(d.versions ?? []).map(bareId)].filter(Boolean));
    if (own.size) take(d, "message-id", (m) => own.has(m.messageId));
  }
  for (const d of queue) if (bareId(d.mailRef)) take(d, "thread", (m) => fits(d, m) && m.inReplyTo === bareId(d.mailRef));
  for (const d of queue) {
    const s = normSubject(d.subject);
    if (s) take(d, "subject-recipient", (m) => fits(d, m) && normSubject(m.subject) === s);
  }
  return out;
}

export interface ProjectPlan { slug: string; accounts: string[]; mailbox: string; waiting: Array<DraftRow & { versions?: readonly string[] }> }

/** One project: read each account's Sent since the oldest waiting draft minus a day, match, mark. Errors are per account. */
export async function reconcileProject(osa: OsaRun, repos: Repos, p: ProjectPlan): Promise<{ marked: number; errors: string[] }> {
  const oldest = p.waiting.reduce((m, d) => (d.createdAt < m ? d.createdAt : m), p.waiting[0]!.createdAt);
  const from = new Date(Date.parse(oldest) - DAY);
  const sent: SentMessage[] = [];
  const errors: string[] = [];
  for (const account of p.accounts) {
    try {
      sent.push(...(await readSent(osa, account, p.mailbox, from)));
    } catch (e) {
      errors.push(`${p.slug} / ${account}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }
  let marked = 0;
  for (const m of matchSent(p.waiting, sent)) {
    const d = await repos.drafts.markSent(m.draftId, { at: m.sent.date, via: m.via, messageId: m.sent.messageId });
    if (d?.status === "sent") marked++;
  }
  return { marked, errors };
}

/** Active projects that list a Mail account and have drafts waiting. Reads SQLite only. */
async function plans(repos: Repos, since: string): Promise<ProjectPlan[]> {
  const out: ProjectPlan[] = [];
  for (const row of (await repos.projects.registry()).projects) {
    if (row.status !== "active" || row.archived) continue;
    const c = configOf(row);
    if (c.mail.accounts.length === 0) continue;
    const drafts = await repos.drafts.awaitingSent(row.slug, since);
    if (!drafts.length) continue;
    const versions = new Map<number, string[]>();
    for (const v of await repos.mailVersions.ofProject(row.slug)) if (v.draftId !== null) versions.set(v.draftId, [...(versions.get(v.draftId) ?? []), v.messageId]);
    out.push({ slug: row.slug, accounts: c.mail.accounts, mailbox: c.mail.sentMailbox, waiting: drafts.map((d) => ({ ...d, versions: versions.get(d.id) ?? [] })) });
  }
  return out;
}

export function startSentReconciler(o: SentOptions): SentHandle {
  const env = o.env ?? process.env;
  const osa = o.osa ?? defaultOsa;
  const now = o.now ?? (() => new Date());
  const disabled = o.offReason ?? (env.HUB_SENT === "off" ? "HUB_SENT=off" : undefined);
  const base = o.intervalMs ?? (Number(env.HUB_SENT_INTERVAL_MS) || 5 * 60_000);
  const st: SentStatus = { state: disabled ? "off" : "starting", ...(disabled ? { reason: disabled } : {}), projects: [], failures: 0, marked: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running: Promise<void> | undefined;

  const off = (reason: string) => {
    st.state = "off";
    st.reason = reason;
    st.projects = [];
    st.failures = 0;
    delete st.lastError;
  };

  async function pass(): Promise<void> {
    if (disabled) return;
    const todo = await plans(o.repos, new Date(now().getTime() - (o.lookbackDays ?? 30) * DAY).toISOString());
    // No draft waits: Mail is not asked anything.
    if (todo.length === 0) return off("no draft waits to be seen in Sent");
    if (!(await mailRunning(osa).catch(() => false))) return off("Mail is not running");
    const errors: string[] = [];
    for (const p of todo) {
      const r = await reconcileProject(osa, o.repos, p);
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
