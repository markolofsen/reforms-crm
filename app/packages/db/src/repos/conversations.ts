import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { write } from "../tx";
import { clients, drafts, inboundMail, inboxRows, sendLog } from "../schema";
import { touchClient } from "./clients";
import { OPEN_INBOUND } from "./inbound-mail";
import { toReviewDrafts, type ReviewDraft } from "./review";

// P99 S2 (verdicts 1 to 3): Mail lists people, not drafts. One row per `clients` row of the project, with one state word derived
// from the facts the Hub already holds (no column, no migration): an open message of theirs (the Mail reader's `inbound_mail`)
// or an owed `inbox_rows` row the agent escalated with no draft after it is Wrote you; an open draft is Draft ready (On hold for
// Hold); our last send after their last message is Waiting for them; else Done. These three tables are the header index of 9a:
// the list and the words read SQLite only, never Mail.

export const CONVERSATION_STATES = ["wrote", "draft", "hold", "waiting", "done"] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];
/** The list's views (verdict 3): Needs you (Wrote you and Draft ready), Waiting, All; Follow-ups is a filter of All. */
export const CONVERSATION_VIEWS = ["needs_you", "waiting", "all", "sequences"] as const;
export type ConversationView = (typeof CONVERSATION_VIEWS)[number];

export interface ConversationItem {
  client: { id: number; name: string; email: string };
  state: ConversationState;
  /** The newest activity: their last message, our last send or the open draft's last change (ISO). */
  at: string;
  /** The newest thread's subject. */
  subject: string;
  /** Their newest message's stored preview, or the open draft's first words (verdict 13). */
  preview: string;
  /** The brands of the client's drafts, distinct (a chip only when there are two or more). */
  brands: string[];
  /** Their newest open message (the Mail reader's row), the anchor of Prepare reply and No reply needed. */
  inboundId: number | null;
  /** The open draft (at most one: the `drafts_client_open` index), in the review shape. */
  draft: ReviewDraft | null;
  theirLastAt: string | null;
  ourLastAt: string | null;
}

export type ConversationCounts = Record<ConversationView, number>;

const NEEDS: ReadonlySet<ConversationState> = new Set(["wrote", "draft"]);
const max = (...v: Array<string | null | undefined>): string | null => v.filter((x): x is string => !!x).sort().at(-1) ?? null;
const inView = (view: ConversationView, c: ConversationItem): boolean =>
  view === "all" ? true : view === "needs_you" ? NEEDS.has(c.state) : view === "waiting" ? c.state === "waiting" : c.draft?.enrollmentId != null;

/** Verdict 2, first that applies. */
export function stateOf(f: { wrote: boolean; open: "ready" | "hold" | null; theirLastAt: string | null; ourLastAt: string | null }): ConversationState {
  if (f.wrote) return "wrote";
  if (f.open === "ready") return "draft";
  if (f.open === "hold") return "hold";
  if (f.ourLastAt && (!f.theirLastAt || f.ourLastAt > f.theirLastAt)) return "waiting";
  return "done";
}

export function conversationsRepo(db: Db) {
  /**
   * Verdict 1: a sender with an open message the reader kept, and an owed `inbox_rows` row the agent escalated, get a `clients`
   * row as `record-client` would (rules README 16 as amended by P99), so every person who needs the owner is one conversation.
   * Idempotent: nothing is written once every such person has a row.
   */
  const ensure = (project: string): void => {
    const known = new Set(db.select({ email: clients.email }).from(clients).where(eq(clients.project, project)).all().map((r) => r.email));
    const open = db.select({ email: inboundMail.email, name: inboundMail.name }).from(inboundMail).where(and(eq(inboundMail.project, project), sql.raw(OPEN_INBOUND))).all();
    const owed = db.select({ email: inboxRows.email, name: inboxRows.name }).from(inboxRows).where(and(eq(inboxRows.project, project), eq(inboxRows.action, "escalated"), eq(inboxRows.repliesOwed, true))).all();
    const missing = [...open, ...owed].filter((r) => !known.has(r.email.trim().toLowerCase()));
    if (missing.length === 0) return;
    write(db, (tx) => {
      for (const r of missing) touchClient(tx, { project, email: r.email, name: r.name });
    });
  };

  // `ensure` writes, so only the list runs it: `one` is read by `hub mcp` and the prompt hook on a read-only connection.
  const build = (project: string, now?: Date, opts: { ensure?: boolean } = {}): ConversationItem[] => {
    if (opts.ensure) ensure(project);
    const people = db.select().from(clients).where(eq(clients.project, project)).all();
    const all = db.select().from(drafts).where(eq(drafts.project, project)).all();
    const inbound = db.select({ row: inboundMail, open: sql<number>`(case when ${sql.raw(OPEN_INBOUND)} then 1 else 0 end)` }).from(inboundMail).where(eq(inboundMail.project, project)).all();
    const owed = db.select().from(inboxRows).where(and(eq(inboxRows.project, project), eq(inboxRows.action, "escalated"), eq(inboxRows.repliesOwed, true))).all();
    const sends = db.select({ draftId: sendLog.draftId, to: sendLog.toAddr, at: sendLog.doneAt, created: sendLog.createdAt }).from(sendLog).where(and(eq(sendLog.project, project), eq(sendLog.channel, "mail"), eq(sendLog.status, "sent"))).all();
    const openDrafts = all.filter((d) => d.status === "ready" || d.status === "hold");
    const reviewed = new Map(toReviewDrafts(db, project, openDrafts.flatMap((d) => { const c = people.find((p) => p.id === d.clientId); return c ? [{ d, c }] : []; }), now).map((r) => [r.clientId, r]));
    // A person is a Mail conversation once there is mail with them: a draft, a stored message of theirs or an escalated row (a client
    // made by linking a chat, P84, with no mail yet stays in Messengers only).
    const withMail = people.filter((c) => all.some((d) => d.clientId === c.id) || inbound.some((r) => r.row.email === c.email && r.row.dismissedReason !== "lead_notice") || owed.some((r) => r.email === c.email));
    return withMail.map((c) => {
      const mine = all.filter((d) => d.clientId === c.id).sort((a, b) => b.id - a.id);
      const theirs = inbound.filter((r) => r.row.email === c.email && r.row.dismissedReason !== "lead_notice").sort((a, b) => b.row.receivedAt.localeCompare(a.row.receivedAt));
      const openIn = theirs.find((r) => r.open === 1)?.row ?? null;
      const escalated = owed.find((r) => r.email === c.email && !mine.some((d) => d.createdAt > r.recordedAt)) ?? null;
      const sentAts = [...mine.map((d) => d.sentAt), ...sends.filter((s) => (s.draftId !== null && mine.some((d) => d.id === s.draftId)) || s.to.toLowerCase().includes(c.email)).map((s) => s.at ?? s.created)];
      const theirLastAt = max(theirs[0]?.row.receivedAt, escalated?.lastInboundAt);
      const ourLastAt = max(...sentAts);
      const draft = reviewed.get(c.id) ?? null;
      const open = draft ? (draft.status === "hold" ? "hold" : "ready") : null;
      const state = stateOf({ wrote: openIn !== null || escalated !== null, open, theirLastAt, ourLastAt });
      const newest = [theirs[0] ? { at: theirs[0].row.receivedAt, subject: theirs[0].row.subject } : null, mine[0] ? { at: mine[0].updatedAt, subject: mine[0].subject } : null, escalated ? { at: escalated.lastInboundAt ?? escalated.recordedAt, subject: escalated.subject ?? "" } : null]
        .filter((x): x is { at: string; subject: string } => x !== null)
        .sort((a, b) => b.at.localeCompare(a.at))[0];
      const preview = draft && state !== "wrote" ? draft.body.replace(/\s+/g, " ").trim().slice(0, 120) : (openIn ?? theirs[0]?.row)?.preview ?? "";
      return {
        client: { id: c.id, name: c.name, email: c.email },
        state,
        at: max(theirLastAt, ourLastAt, draft?.updatedAt, newest?.at) ?? c.updatedAt,
        subject: newest?.subject ?? "",
        preview,
        brands: [...new Set(mine.map((d) => d.brand).filter((b): b is string => !!b))],
        inboundId: openIn?.id ?? null,
        draft,
        theirLastAt,
        ourLastAt,
      };
    });
  };

  /** Search over the name, the address and the subjects of the client's drafts and messages (`%`, `_` match themselves: plain text). */
  const matches = (project: string, needle: string): Set<number> => {
    const n = needle.trim().toLowerCase();
    const hit = new Set<number>();
    for (const c of db.select().from(clients).where(eq(clients.project, project)).all()) if (c.name.toLowerCase().includes(n) || c.email.includes(n)) hit.add(c.id);
    for (const d of db.select({ id: drafts.clientId, s: drafts.subject }).from(drafts).where(eq(drafts.project, project)).all()) if (d.s.toLowerCase().includes(n)) hit.add(d.id);
    return hit;
  };

  return {
    /**
     * The Mail list (verdicts 2, 3): one row per client in the view, Needs you's states first (Wrote you, Draft ready), then the
     * newest activity on top; the client id breaks a tie. `batch` keeps the clients a batch wrote a draft for (a read-only view,
     * decision 0025); `search` narrows by name, address or subject. Counts are never narrowed by the search; a batch narrows them.
     */
    async list(project: string, view: ConversationView, opts: { batch?: number | null; search?: string; limit?: number; offset?: number; now?: Date } = {}): Promise<{ rows: ConversationItem[]; total: number; counts: ConversationCounts }> {
      let rows = build(project, opts.now, { ensure: true });
      if (opts.batch) {
        const inBatch = new Set(db.select({ id: drafts.clientId }).from(drafts).where(and(eq(drafts.project, project), eq(drafts.batchId, opts.batch))).all().map((r) => r.id));
        rows = rows.filter((r) => inBatch.has(r.client.id));
      }
      const n = (v: ConversationView) => rows.filter((r) => inView(v, r)).length;
      const counts: ConversationCounts = { needs_you: n("needs_you"), waiting: n("waiting"), all: n("all"), sequences: n("sequences") };
      const hit = opts.search?.trim() ? matches(project, opts.search) : null;
      const shown = rows
        .filter((r) => inView(view, r) && (hit === null || hit.has(r.client.id)))
        .sort((a, b) => Number(NEEDS.has(b.state)) - Number(NEEDS.has(a.state)) || b.at.localeCompare(a.at) || a.client.id - b.client.id);
      const offset = opts.offset ?? 0;
      return { rows: shown.slice(offset, opts.limit === undefined ? undefined : offset + opts.limit), total: shown.length, counts };
    },

    /** One conversation's row (the pane's header and its unsent message), or null when the client is not this project's. */
    async one(project: string, clientId: number, now?: Date): Promise<ConversationItem | null> {
      return build(project, now).find((r) => r.client.id === clientId) ?? null;
    },

    /** The Hub's own facts of one conversation, newest first: every draft, every stored message of theirs, every mail send. No body (0013). */
    async facts(project: string, clientId: number) {
      const c = db.select().from(clients).where(and(eq(clients.project, project), eq(clients.id, clientId))).get();
      if (!c) return null;
      const mine = db.select().from(drafts).where(and(eq(drafts.project, project), eq(drafts.clientId, clientId))).all().sort((a, b) => b.id - a.id);
      const theirs = db.select().from(inboundMail).where(and(eq(inboundMail.project, project), eq(inboundMail.email, c.email))).all().filter((r) => r.dismissedReason !== "lead_notice").sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      const ids = mine.map((d) => d.id);
      const sends = ids.length ? db.select().from(sendLog).where(and(eq(sendLog.project, project), eq(sendLog.channel, "mail"), inArray(sendLog.draftId, ids))).all() : [];
      return { client: c, drafts: mine, inbound: theirs, sends };
    },
  };
}
