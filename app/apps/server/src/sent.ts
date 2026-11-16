import { matchSent, readSent, type SentMessage } from "@hub/mail/imap";
import type { Repos } from "@hub/db";
import type { MailService } from "./mail";

/**
 * Sent detection (doc 14 step 6). A draft (bulk or recorded by a session) becomes `sent` only when its message shows up in the Sent folder of one
 * of the project's mail accounts: the app never sends and never treats a keypress as proof. This loop only reads
 * (SEARCH and FETCH on a read-only mailbox). It is off while no project has a matching login file, and it touches the
 * network only while some draft is still waiting.
 */
export interface SentStatus {
  state: "off" | "starting" | "running" | "error" | "stopped";
  reason?: string;
  /** Projects checked on the last pass. */
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
  mail: MailService;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Between passes. Default 5 minutes (HUB_SENT_INTERVAL_MS). Doubles after each failed pass, up to one hour. */
  intervalMs?: number;
  /** How far back a draft can still be matched. Default 30 days. */
  lookbackDays?: number;
  /** Set false in tests that call `tick()` themselves. */
  timer?: boolean;
}

const DAY = 86_400_000;

export interface ReconcileResult {
  checked: number;
  marked: number;
  /** One line per account that could not be read, already redacted. */
  errors: string[];
}

/** One project, one pass: read each of its Sent folders since the oldest waiting draft, match, mark. */
export async function reconcileProject(o: { repos: Repos; mail: MailService; project: string; now: Date; lookbackDays: number }): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, marked: 0, errors: [] };
  const since = new Date(o.now.getTime() - o.lookbackDays * DAY).toISOString();
  const waiting = await o.repos.drafts.awaitingSent(o.project, since);
  result.checked = waiting.length;
  if (waiting.length === 0) return result;
  const accounts = await o.mail.accountsFor(o.project);
  if (accounts.length === 0) return result;

  // Read from a day before the oldest waiting draft: IMAP SINCE is day-granular and clocks differ.
  const oldest = waiting.reduce((m, d) => (d.createdAt < m ? d.createdAt : m), waiting[0]!.createdAt);
  const from = new Date(Date.parse(oldest) - DAY);
  const sent: SentMessage[] = [];
  for (const a of accounts) {
    let session: Awaited<ReturnType<MailService["connect"]>> | undefined;
    try {
      session = await o.mail.connect(a);
      sent.push(...(await readSent(a, session, from)));
    } catch (e) {
      result.errors.push(`${a.name}: ${o.mail.redact(e instanceof Error ? e.message : String(e))}`);
    } finally {
      await session?.close().catch(() => {});
    }
  }

  const matches = matchSent(
    waiting.map((d) => ({ id: d.id, subject: d.subject, to: d.toAddr, mailRef: d.mailRef, createdAt: d.createdAt })),
    sent,
  );
  for (const m of matches) {
    const d = await o.repos.drafts.markSent(m.draftId, { at: m.sent.date, via: m.via, messageId: m.sent.messageId });
    if (d && d.status === "sent") result.marked++;
  }
  return result;
}

export function startSentReconciler(o: SentOptions): SentHandle {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  const base = o.intervalMs ?? (Number(env.HUB_SENT_INTERVAL_MS) || 5 * 60_000);
  const st: SentStatus = { state: env.HUB_SENT === "off" ? "off" : "starting", ...(env.HUB_SENT === "off" ? { reason: "HUB_SENT=off" } : {}), projects: [], failures: 0, marked: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running: Promise<void> | undefined;

  async function pass(): Promise<void> {
    if (env.HUB_SENT === "off") return;
    const { projects } = await o.repos.projects.registry();
    const active = projects.filter((p) => p.status === "active");
    const checked: string[] = [];
    const errors: string[] = [];
    for (const p of active) {
      try {
        if ((await o.mail.accountsFor(p.slug)).length === 0) continue;
        const r = await reconcileProject({ repos: o.repos, mail: o.mail, project: p.slug, now: now(), lookbackDays: o.lookbackDays ?? 30 });
        checked.push(p.slug);
        st.marked += r.marked;
        errors.push(...r.errors);
      } catch (e) {
        errors.push(`${p.slug}: ${o.mail.redact(e instanceof Error ? e.message : String(e))}`);
      }
    }
    st.projects = checked;
    if (checked.length === 0 && errors.length === 0) {
      st.state = "off";
      st.reason = "no active project has a mail login file for its mail.accounts";
      st.failures = 0;
      delete st.lastError;
      return;
    }
    delete st.reason;
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
    if (stopped || o.timer === false || env.HUB_SENT === "off") return;
    timer = setTimeout(() => void tick().finally(schedule), Math.min(base * 2 ** Math.min(st.failures, 6), 3_600_000));
    timer.unref?.();
  };
  if (env.HUB_SENT !== "off" && o.timer !== false) void tick().finally(schedule);

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
