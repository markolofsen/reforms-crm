import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { MARKS, type Mark, type SafetyResult } from "@hub/config";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { evaluateSafety } from "../safety";
import { clients, drafts, mailVersions, marks, sendControl, sendLog, type MessengerChannel, type SendStatus } from "../schema";
import { evidenceOf, loadRules, nowIso, parseJson } from "./bulk-shared";
import { write, type WriteTx } from "../tx";

export type SendRow = typeof sendLog.$inferSelect;
export type DraftRow = typeof drafts.$inferSelect;

/** What a send attempt records. `body` is the full text; nothing is truncated. */
export type NewSend = {
  project: string;
  draftId: number;
  mode: "manual" | "auto";
  /** `sending` for a manual send, `queued` for an autosend that waits out its window (then `dueAt` is required). */
  status: "sending" | "queued";
  actor: string;
  /** When the attempt started; default now. A runner passes its own clock so the daily cap and the window agree with it. */
  at?: string;
  dueAt?: string | null;
  sender?: string | null;
  to: string;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  body: string;
  mailRef?: string | null;
};

/**
 * One messenger send a person confirmed (P71 M4). `account` is the sending account's id (stored as `sender`); `to` is
 * `<channel>:<chat id>`; `name` is who it goes to (stored as `subject`); `text` the full text.
 */
export type NewMessengerSend = {
  project: string;
  channel: MessengerChannel;
  messengerDraftId: number;
  account: string;
  to: string;
  name: string;
  text: string;
  actor: string;
  at: string;
  /** The guards of one account (decision 0036 point 7), re-checked inside the write so two sends cannot both pass. */
  limits: { dailyCap: number; spacingSeconds: number };
  /** Decision 0046: the session-log reference of the owner's word an agent send goes out on; one send per word. */
  ownerWord?: string | null;
};

/** What one messenger account has used: live rows of the last 24 h (the cap) and its newest attempt of any outcome (the spacing). */
export type MessengerUsage = { sentLastDay: number; lastAttemptAt: string | null };

const DAY_MS = 86_400_000;
const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint/i.test(e.message);
const LIVE: SendStatus[] = ["queued", "sending", "sent"];

type Reader = Db | WriteTx;

function usage(db: Reader, channel: MessengerChannel, account: string, at: string): MessengerUsage {
  const mine = and(eq(sendLog.channel, channel), eq(sendLog.sender, account));
  const since = new Date(new Date(at).getTime() - DAY_MS).toISOString();
  const n = db.select({ n: sql<number>`count(*)` }).from(sendLog).where(and(mine, inArray(sendLog.status, ["sending", "sent"]), gte(sendLog.createdAt, since))).get();
  const last = db.select({ at: sql<string | null>`max(${sendLog.createdAt})` }).from(sendLog).where(and(mine, inArray(sendLog.status, ["sending", "sent", "failed"]))).get();
  return { sentLastDay: Number(n?.n ?? 0), lastAttemptAt: last?.at ?? null };
}

/** Throws `wrong_state` with `words` when Stop sending is on for this project or every project: read inside a send row's own write. */
function refuseWhenStopped(tx: WriteTx, project: string, words: string): void {
  if (tx.select().from(sendControl).where(and(inArray(sendControl.project, ["*", project]), eq(sendControl.stopped, true))).get()) throw new RepoError("wrong_state", words);
}

/**
 * Why one more messenger send on this account is refused now, in the owner's words, or null. The cap counts sending and sent rows of
 * the last 24 h; the spacing counts every attempt, a failed one too, since it reached Telegram.
 */
export function usageRefusal(u: MessengerUsage, limits: { dailyCap: number; spacingSeconds: number }, at: string): string | null {
  if (u.sentLastDay >= limits.dailyCap) return `this account sent ${u.sentLastDay} messages in the last 24 hours, the cap is ${limits.dailyCap}`;
  if (u.lastAttemptAt) {
    const wait = Math.ceil((new Date(u.lastAttemptAt).getTime() + limits.spacingSeconds * 1000 - new Date(at).getTime()) / 1000);
    if (wait > 0) return `the last send on this account was under ${limits.spacingSeconds} seconds ago: wait ${wait} s`;
  }
  return null;
}

/**
 * The send audit and the Stop all switch (decision 0011). Only the hub's `hub send` calls the writers; the agent has
 * no path here. Nothing writes `drafts.status`: Mail's Sent folder is still the one source of "sent", read by the reconciler.
 */
export function sendsRepo(db: Db) {
  const row = (id: number) => db.select().from(sendLog).where(eq(sendLog.id, id)).get() ?? null;

  return {
    async get(id: number): Promise<SendRow | null> {
      return row(id);
    },

    /** Rows of a draft, newest first. */
    async forDraft(draftId: number): Promise<SendRow[]> {
      return db.select().from(sendLog).where(eq(sendLog.draftId, draftId)).orderBy(sql`${sendLog.id} desc`).all();
    },

    /** Decision 0046: the owner's words of this project an agent send already went out on (any outcome): one send per word. */
    async ownerWordsUsed(project: string): Promise<Set<string>> {
      return new Set(db.select({ w: sendLog.ownerWord }).from(sendLog).where(and(eq(sendLog.project, project), sql`${sendLog.ownerWord} is not null`)).all().map((r) => r.w as string));
    },

    /** The send history, newest first; each row with its draft's client (P99: a mail send links its conversation). */
    async list(project: string, limit = 100): Promise<Array<SendRow & { clientId: number | null }>> {
      return db
        .select({ s: sendLog, clientId: drafts.clientId })
        .from(sendLog)
        .leftJoin(drafts, eq(drafts.id, sendLog.draftId))
        .where(eq(sendLog.project, project))
        .orderBy(sql`${sendLog.id} desc`)
        .limit(limit)
        .all()
        .map((r) => ({ ...r.s, clientId: r.clientId ?? null }));
    },

    /** Starts an attempt. `wrong_state` when the draft already has a queued, sending or sent row: no second send. */
    async begin(input: NewSend): Promise<SendRow> {
      if (input.status === "queued" && !input.dueAt) throw new RepoError("wrong_state", "A queued send needs a due time");
      return write(db, (tx) => {
        // P112 S2: Stop sending is read again in the row's own write, as `beginMessage` does: no new work starts once it is on.
        refuseWhenStopped(tx, input.project, "Stop all is on");
        try {
          return tx
            .insert(sendLog)
            .values({
              project: input.project,
              draftId: input.draftId,
              mode: input.mode,
              status: input.status,
              actor: input.actor,
              ...(input.at ? { createdAt: input.at } : {}),
              dueAt: input.dueAt ?? null,
              sender: input.sender ?? null,
              toAddr: input.to,
              ccAddr: input.cc ?? null,
              bccAddr: input.bcc ?? null,
              subject: input.subject,
              body: input.body,
              mailRef: input.mailRef ?? null,
            })
            .returning()
            .get();
        } catch (e) {
          if (isUnique(e)) throw new RepoError("wrong_state", "This draft is already queued, being sent or sent");
          throw e;
        }
      });
    },

    /** The usage of one messenger account at `at` (P71 M4): what the daily cap and the spacing are judged against. */
    async messengerUsage(channel: MessengerChannel, account: string, at: string): Promise<MessengerUsage> {
      return usage(db, channel, account, at);
    },

    /**
     * Starts a messenger send (P71 M4): Stop all, the daily cap and the spacing are checked again inside the same write
     * transaction that inserts the `sending` row, so the audit row exists before anything leaves and two sends cannot race
     * past a guard. `wrong_state` with the reason in words when a guard refuses, or when the draft already has a live row.
     */
    async beginMessage(input: NewMessengerSend): Promise<SendRow> {
      return write(db, (tx) => {
        refuseWhenStopped(tx, input.project, "Stop sending is on");
        const u = usage(tx, input.channel, input.account, input.at);
        const refused = usageRefusal(u, input.limits, input.at);
        if (refused) throw new RepoError("wrong_state", refused);
        const word = input.ownerWord ?? null;
        if (word !== null && tx.select({ id: sendLog.id }).from(sendLog).where(eq(sendLog.ownerWord, word)).get()) throw new RepoError("wrong_state", "this word of the owner was already used for a send: one send per word");
        try {
          return tx
            .insert(sendLog)
            .values({ project: input.project, channel: input.channel, messengerDraftId: input.messengerDraftId, draftId: null, mode: "manual", status: "sending", actor: input.actor, createdAt: input.at, sender: input.account, toAddr: input.to, subject: input.name, body: input.text, ownerWord: word })
            .returning()
            .get();
        } catch (e) {
          if (isUnique(e)) throw new RepoError("wrong_state", "This draft is already being sent or sent");
          throw e;
        }
      });
    },

    /** queued -> sending, once, for whoever gets there first. Null when it is no longer queued (cancelled, or another runner took it). */
    async claim(id: number): Promise<SendRow | null> {
      return write(db, (tx) => tx.update(sendLog).set({ status: "sending" }).where(and(eq(sendLog.id, id), eq(sendLog.status, "queued"))).returning().get() ?? null);
    },

    /**
     * Finishes a send the hub made. The draft it came from becomes `sent` in the same transaction (P27 M4.1): the queue
     * must not offer a draft that went out. `sent` is still written only here and by the Sent-folder reader, never by a route.
     */
    async markSent(id: number, messageId: string | null): Promise<SendRow | null> {
      return write(db, (tx) => {
        const at = nowIso();
        const row = tx.update(sendLog).set({ status: "sent", sentMessageId: messageId, doneAt: at, error: null }).where(and(eq(sendLog.id, id), eq(sendLog.status, "sending"))).returning().get() ?? null;
        if (row?.draftId != null) {
          tx.update(drafts)
            .set({ status: "sent", sentAt: at, sentVia: "hub", sentMessageId: messageId, prevStatus: null, prevChecked: null, actedAt: at, updatedAt: at })
            .where(and(eq(drafts.id, row.draftId), inArray(drafts.status, ["ready", "hold", "done"])))
            .run();
        }
        return row;
      });
    },

    /**
     * P96 verdict 13: the door's sends whose new Message-ID is not known yet (Mail assigns a new one at send, measured on
     * 2026-11-20), sent since `since`, oldest first. Mail only.
     */
    async awaitingMessageId(project: string, since: string): Promise<SendRow[]> {
      return db
        .select()
        .from(sendLog)
        .where(and(eq(sendLog.project, project), eq(sendLog.channel, "mail"), eq(sendLog.status, "sent"), sql`${sendLog.sentMessageId} is null`, gte(sendLog.doneAt, since)))
        .orderBy(sendLog.doneAt)
        .all();
    },

    /** P96 verdict 13: the Message-ID read back from Sent, on the send row and its draft, only where none is recorded. */
    async setSentMessageId(id: number, messageId: string): Promise<boolean> {
      return write(db, (tx) => {
        const row = tx.update(sendLog).set({ sentMessageId: messageId }).where(and(eq(sendLog.id, id), sql`${sendLog.sentMessageId} is null`)).returning().get();
        if (!row) return false;
        if (row.draftId != null) tx.update(drafts).set({ sentMessageId: messageId }).where(and(eq(drafts.id, row.draftId), sql`${drafts.sentMessageId} is null`)).run();
        return true;
      });
    },

    async markFailed(id: number, error: string): Promise<SendRow | null> {
      return write(db, (tx) => tx.update(sendLog).set({ status: "failed", error: error.slice(0, 1000), doneAt: nowIso() }).where(and(eq(sendLog.id, id), inArray(sendLog.status, ["queued", "sending"]))).returning().get() ?? null);
    },

    /** Cancels a queued send (the window). A row already sending or sent cannot be cancelled: a sent mail cannot be recalled. */
    async cancel(id: number, why = "cancelled"): Promise<SendRow | null> {
      return write(db, (tx) => tx.update(sendLog).set({ status: "cancelled", error: why, doneAt: nowIso() }).where(and(eq(sendLog.id, id), eq(sendLog.status, "queued"))).returning().get() ?? null);
    },

    /** Queued rows whose window is over, oldest first. */
    async due(now: string, project?: string): Promise<SendRow[]> {
      const where = and(eq(sendLog.status, "queued"), lte(sendLog.dueAt, now), ...(project ? [eq(sendLog.project, project)] : []));
      return db.select().from(sendLog).where(where).orderBy(sendLog.dueAt).all();
    },

    async queued(project?: string): Promise<SendRow[]> {
      return db.select().from(sendLog).where(and(eq(sendLog.status, "queued"), ...(project ? [eq(sendLog.project, project)] : []))).orderBy(sendLog.dueAt).all();
    },

    /**
     * P85b: what one project's batch sends have used (`actor` = `actor`): sending and sent rows of the last 24 h (its own daily
     * cap) and the newest attempt of any outcome (the spacing between two mails of a run).
     */
    async actorUsage(project: string, actor: string, at: string): Promise<MessengerUsage> {
      const mine = and(eq(sendLog.project, project), eq(sendLog.actor, actor), eq(sendLog.channel, "mail"));
      const since = new Date(new Date(at).getTime() - DAY_MS).toISOString();
      const n = db.select({ n: sql<number>`count(*)` }).from(sendLog).where(and(mine, inArray(sendLog.status, ["sending", "sent"]), gte(sendLog.createdAt, since))).get();
      const last = db.select({ at: sql<string | null>`max(${sendLog.createdAt})` }).from(sendLog).where(and(mine, inArray(sendLog.status, ["sending", "sent", "failed"]))).get();
      return { sentLastDay: Number(n?.n ?? 0), lastAttemptAt: last?.at ?? null };
    },

    /** Attempts that count against the daily cap: queued, sending and sent, autosends only, since `since`. */
    async autoCountSince(project: string, since: string): Promise<number> {
      const r = db
        .select({ n: sql<number>`count(*)` })
        .from(sendLog)
        .where(and(eq(sendLog.project, project), eq(sendLog.mode, "auto"), inArray(sendLog.status, LIVE), gte(sendLog.createdAt, since)))
        .get();
      return r?.n ?? 0;
    },

    /**
     * The Overview's send numbers for one project, all from `send_log`: `sentToday` (status sent, manual and auto, made
     * since `today`), `failed` (failed since `day`) and `stuck` (still `sending` and older than `stuckBefore`: a crash
     * left it, and it blocks a second send of that draft until a person looks).
     */
    async summarySince(project: string, o: { today: string; day: string; stuckBefore: string }): Promise<{ sentToday: number; failed: number; stuck: number }> {
      const recent = db
        .select({
          sentToday: sql<number>`coalesce(sum(case when ${sendLog.status} = 'sent' and ${sendLog.createdAt} >= ${o.today} then 1 else 0 end), 0)`,
          failed: sql<number>`coalesce(sum(case when ${sendLog.status} = 'failed' and ${sendLog.createdAt} >= ${o.day} then 1 else 0 end), 0)`,
        })
        .from(sendLog)
        .where(and(eq(sendLog.project, project), gte(sendLog.createdAt, o.today < o.day ? o.today : o.day)))
        .get();
      const stuck = db
        .select({ n: sql<number>`count(*)` })
        .from(sendLog)
        .where(and(eq(sendLog.project, project), eq(sendLog.status, "sending"), lte(sendLog.createdAt, o.stuckBefore)))
        .get();
      return { sentToday: recent?.sentToday ?? 0, failed: recent?.failed ?? 0, stuck: stuck?.n ?? 0 };
    },

    /** Stop all (`project` omitted: every project). Also cancels the queued rows in scope. Returns how many were cancelled. */
    async stop(project?: string): Promise<number> {
      return write(db, (tx) => {
        const scope = project ?? "*";
        tx.insert(sendControl).values({ project: scope, stopped: true }).onConflictDoUpdate({ target: sendControl.project, set: { stopped: true, updatedAt: nowIso() } }).run();
        const rows = tx
          .update(sendLog)
          .set({ status: "cancelled", error: "Stop all", doneAt: nowIso() })
          .where(and(eq(sendLog.status, "queued"), ...(project ? [eq(sendLog.project, project)] : [])))
          .returning({ id: sendLog.id })
          .all();
        return rows.length;
      });
    },

    async resume(project?: string): Promise<void> {
      write(db, (tx) => {
        tx.insert(sendControl).values({ project: project ?? "*", stopped: false }).onConflictDoUpdate({ target: sendControl.project, set: { stopped: false, updatedAt: nowIso() } }).run();
      });
    },

    /** True when Stop all is on for every project or for this one. */
    async isStopped(project: string): Promise<boolean> {
      const r = db.select().from(sendControl).where(and(inArray(sendControl.project, ["*", project]), eq(sendControl.stopped, true))).get();
      return !!r;
    },

    async stoppedScopes(): Promise<string[]> {
      return db.select({ p: sendControl.project }).from(sendControl).where(eq(sendControl.stopped, true)).all().map((r) => r.p);
    },

    /** Ready drafts of the project in the given mail classes, oldest first: the autosend candidates. */
    async readyOfClasses(project: string, classes: string[]): Promise<DraftRow[]> {
      if (classes.length === 0) return [];
      return db.select().from(drafts).where(and(eq(drafts.project, project), eq(drafts.status, "ready"), inArray(drafts.mailClass, classes))).orderBy(drafts.id).all();
    },

    /** What the send checks need beyond the draft row: the client's address and marks. Null when the draft is unknown. */
    async subject(draftId: number): Promise<{ draft: DraftRow; client: { id: number; email: string; repliesOwed: boolean; marks: Mark[] } } | null> {
      const d = db.select().from(drafts).where(eq(drafts.id, draftId)).get();
      if (!d) return null;
      const c = db.select().from(clients).where(eq(clients.id, d.clientId)).get();
      if (!c) return null;
      const m = db.select({ mark: marks.mark }).from(marks).where(eq(marks.clientId, c.id)).all().map((r) => r.mark);
      return { draft: d, client: { id: c.id, email: c.email, repliesOwed: c.repliesOwed, marks: m.filter((x): x is Mark => (MARKS as readonly string[]).includes(x)) } };
    },

    /**
     * The safety rules of the project run on the text that will really go out (the one in Mail, not the excerpt the
     * row holds). Results the person acknowledged on the draft keep their `acked` flag.
     */
    async safetyOf(draftId: number, actual: { subject: string; toAddr: string; ccAddr: string | null; body: string }, now: Date = new Date()): Promise<SafetyResult[]> {
      const s = await this.subject(draftId);
      if (!s) return [];
      const { draft, client } = s;
      const closed = db
        .select({ at: sql<string | null>`max(${drafts.actedAt})` })
        .from(drafts)
        .where(and(eq(drafts.clientId, client.id), or(eq(drafts.status, "done"), eq(drafts.status, "sent")), sql`${drafts.id} <> ${draftId}`))
        .get();
      // P65 S2: the newest Mail version the Hub wrote says whether it had to sign in English.
      const newest = db.select({ fallback: mailVersions.signatureFallback }).from(mailVersions).where(eq(mailVersions.draftId, draftId)).orderBy(desc(mailVersions.id)).limit(1).get();
      return evaluateSafety(
        // P85b: the stored evidence block too, as the list's own results have it (`loadSafety`): without it the card's live checks
        // left out the evidence and near-duplicate checks that still blocked Checked, so a batch draft could not be Checked at all.
        { draft: { ...actual, mailRef: draft.mailRef }, client, lastClosedAt: closed?.at ?? null, now, signatureFallback: newest?.fallback ?? null, evidence: evidenceOf(draft) },
        loadRules(db, draft.project),
        parseJson<string[]>(draft.acked, []),
      );
    },
  };
}
