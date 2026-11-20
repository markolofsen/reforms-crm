import { and, asc, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { type ClientCounts, type ClientFilter, type Mark } from "@hub/config";
import { toReviewDrafts, type ReviewDraft } from "./review";
import type { Db } from "../client";
import { write } from "../tx";
import { clients, drafts, marks } from "../schema";
import { onClientWrote } from "./enrollments";

export type DraftRow = typeof drafts.$inferSelect;
export type ClientRow = typeof clients.$inferSelect & { marks: Mark[]; draft: DraftRow | null };
export type NewClient = Omit<typeof clients.$inferInsert, "id" | "createdAt" | "updatedAt">;

// A client may have several drafts over time (finished ones stay as history); the lists show the newest.
// Literal table names in the sub-select: drizzle drops qualifiers in a single-table select (`@rules/README.md` rule 15).
const latestDraft = sql`${drafts.id} = (select max(d2.id) from drafts d2 where d2.client_id = clients.id)`;

// One definition per filter, used by both the list and the counts so they cannot drift. The Drafts list inner-joins
// the draft, so every row has one.
const open = inArray(drafts.status, ["ready", "hold"]);
const predicates: Record<ClientFilter, SQL | undefined> = {
  all: undefined,
  ready: eq(drafts.status, "ready"),
  hold: eq(drafts.status, "hold"),
  owed: and(eq(clients.repliesOwed, true), open),
  done: eq(drafts.status, "done"),
  sent: eq(drafts.status, "sent"),
  skipped: eq(drafts.status, "skipped"),
  // An open draft whose own evidence block is weak or missing: look at it before the rest.
  thin_basis: and(open, or(eq(drafts.evidence, "weak"), eq(drafts.evidence, "missing"))),
  // An open draft that is a step of a follow-up sequence (P47).
  sequences: and(open, isNotNull(drafts.enrollmentId)),
};

/**
 * Which drafts a list covers: every draft of each client, or (a batch) exactly the drafts the batch wrote. P87 (B3): the open
 * views stay one row per client (the `drafts_client_open` index allows one open draft), while Finished and All keep each finished
 * draft, so a sent mail is still listed after a newer draft to the same client (it used to read the newest draft only).
 */
export type DraftScope = { batch?: number | null };
const scopeOf = (s: DraftScope): SQL => (s.batch ? and(eq(drafts.clientId, clients.id), eq(drafts.batchId, s.batch))! : eq(drafts.clientId, clients.id));

/** A substring match over the client's name and address and the draft's subject. `%`, `_` and `\` in the text match themselves. */
function searchSql(text: string | undefined): SQL | undefined {
  const needle = text?.trim().toLowerCase();
  if (!needle) return undefined;
  const pattern = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  return sql`(lower(${clients.name}) like ${pattern} escape '\\' or lower(${clients.email}) like ${pattern} escape '\\' or lower(${drafts.subject}) like ${pattern} escape '\\')`;
}

/** What `touch` may set. Only these columns; a client row is never deleted (marks, identifiers and the log hang on it). */
export type ClientTouch = { project: string; email: string; name: string; lastContactAt?: string | null; repliesOwed?: boolean };

/** A name that is a person's or a company's, not empty and not an address (P87, B5: a record without a name gave the address). */
export const isRealName = (name: string, email: string): boolean => {
  const n = name.trim();
  return n !== "" && !n.includes("@") && n.toLowerCase() !== email.trim().toLowerCase();
};

/**
 * The shared body of `touch`, sync so `drafts.record` can run it inside its own transaction. A new row takes the name, else the
 * address; an existing row's name is replaced only by a real name (`isRealName`), never by an empty one or an address (P87, B5).
 */
export function touchClient(tx: Pick<Db, "select" | "insert" | "update">, input: ClientTouch): { id: number; created: boolean } {
  const email = input.email.trim().toLowerCase();
  const real = isRealName(input.name, email);
  const at = new Date().toISOString();
  const set = {
    updatedAt: at,
    ...(input.repliesOwed === undefined ? {} : { repliesOwed: input.repliesOwed }),
    ...(input.lastContactAt === undefined ? {} : { lastContactAt: input.lastContactAt }),
  };
  const found = tx.select({ id: clients.id }).from(clients).where(and(eq(clients.project, input.project), eq(clients.email, email))).get();
  if (found) {
    tx.update(clients).set({ ...set, ...(real ? { name: input.name.trim() } : {}) }).where(eq(clients.id, found.id)).run();
    return { id: found.id, created: false };
  }
  const row = tx
    .insert(clients)
    .values({ project: input.project, email, name: real ? input.name.trim() : input.name.trim() || email, ...set })
    .returning({ id: clients.id })
    .get();
  return { id: row.id, created: true };
}

export function clientsRepo(db: Db) {
  const withMarks = (rows: Array<{ client: typeof clients.$inferSelect; draft: DraftRow | null }>): ClientRow[] => {
    const ids = rows.map((r) => r.client.id);
    const markRows = ids.length ? db.select({ clientId: marks.clientId, mark: marks.mark }).from(marks).where(inArray(marks.clientId, ids)).all() : [];
    const byClient = new Map<number, Mark[]>();
    for (const m of markRows) byClient.set(m.clientId, [...(byClient.get(m.clientId) ?? []), m.mark]);
    return rows.map((r) => ({ ...r.client, marks: byClient.get(r.client.id) ?? [], draft: r.draft }));
  };

  return {
    async create(input: NewClient): Promise<number> {
      const row = db.insert(clients).values(input).returning({ id: clients.id }).get();
      return row.id;
    },

    /** Insert, or refresh the row of the same (project, email). Never touches marks or drafts. */
    async upsert(input: NewClient): Promise<{ id: number }> {
      const { project, email, ...rest } = input;
      return db
        .insert(clients)
        .values(input)
        .onConflictDoUpdate({ target: [clients.project, clients.email], set: { ...rest, updatedAt: new Date().toISOString() } })
        .returning({ id: clients.id })
        .get();
    },

    /** Insert the client, or update only name, repliesOwed and lastContactAt (those given). Never deletes. */
    async touch(input: ClientTouch): Promise<{ id: number; created: boolean }> {
      return write(db, (tx) => touchClient(tx, input));
    },

    /** The Drafts list: only clients that have a draft, with the newest one. Owed first, then the longest silence; finished rows last. */
    async list(project: string, filter: ClientFilter = "all"): Promise<ClientRow[]> {
      const rows = db
        .select({ client: clients, draft: drafts })
        .from(clients)
        .innerJoin(drafts, latestDraft)
        .where(and(eq(clients.project, project), predicates[filter]))
        .orderBy(sql`case when ${drafts.status} in ('done','sent','skipped') then 1 else 0 end`, desc(clients.repliesOwed), sql`case when ${clients.lastContactAt} is null then 1 else 0 end`, asc(clients.lastContactAt))
        .all();
      return withMarks(rows.map((r) => ({ client: r.client, draft: r.draft })));
    },

    /**
     * The Drafts screen: the drafts of each client that has one (every draft since P87; the open views hold one per client), in
     * the shape the review screen shares with a bulk batch (typed safety results, tone bodies, the Checked gate). Same order as
     * `list`; `limit` and `offset` page it.
     */
    async review(project: string, filter: ClientFilter = "all", opts: DraftScope & { limit?: number; offset?: number; now?: Date; search?: string } = {}): Promise<ReviewDraft[]> {
      const rows = db
        .select({ d: drafts, c: clients })
        .from(clients)
        .innerJoin(drafts, scopeOf(opts))
        .where(and(eq(clients.project, project), predicates[filter], searchSql(opts.search)))
        .orderBy(sql`case when ${drafts.status} in ('done','sent','skipped') then 1 else 0 end`, desc(clients.repliesOwed), sql`case when ${clients.lastContactAt} is null then 1 else 0 end`, asc(clients.lastContactAt), asc(drafts.id))
        .limit(opts.limit ?? -1)
        .offset(opts.offset ?? 0)
        .all();
      return toReviewDrafts(db, project, rows, opts.now);
    },

    /** How many rows `review` returns for the same arguments before paging: the filter's count narrowed by the search. */
    async reviewTotal(project: string, filter: ClientFilter, opts: DraftScope & { search?: string } = {}): Promise<number> {
      const row = db
        .select({ n: sql<number>`count(*)` })
        .from(clients)
        .innerJoin(drafts, scopeOf(opts))
        .where(and(eq(clients.project, project), predicates[filter], searchSql(opts.search)))
        .get();
      return row?.n ?? 0;
    },

    /** The numbers beside the views. Never narrowed by a search; a batch narrows them to its own drafts. */
    async counts(project: string, scope: DraftScope = {}): Promise<ClientCounts> {
      const count = (f: ClientFilter) => (predicates[f] ? sql<number>`count(*) filter (where ${predicates[f]})` : sql<number>`count(*)`);
      const row = db
        .select({ all: count("all"), ready: count("ready"), hold: count("hold"), owed: count("owed"), done: count("done"), sent: count("sent"), skipped: count("skipped"), thin_basis: count("thin_basis"), sequences: count("sequences") })
        .from(clients)
        .innerJoin(drafts, scopeOf(scope))
        .where(eq(clients.project, project))
        .get();
      return row ?? { all: 0, ready: 0, hold: 0, owed: 0, done: 0, sent: 0, skipped: 0, thin_basis: 0, sequences: 0 };
    },

    /** Replaces the marks of a client. Returns false when the client does not exist. */
    async setMarks(clientId: number, next: Mark[]): Promise<boolean> {
      return write(db, (tx) => {
        const c = tx.select({ project: clients.project }).from(clients).where(eq(clients.id, clientId)).get();
        if (!c) return false;
        const had = tx.select({ mark: marks.mark }).from(marks).where(eq(marks.clientId, clientId)).all().some((m) => m.mark === "do_not_contact");
        tx.delete(marks).where(eq(marks.clientId, clientId)).run();
        for (const mark of new Set(next)) tx.insert(marks).values({ project: c.project, clientId, mark }).run();
        // P47: Do not contact ends the client's follow-ups (opted out) and skips the open step draft, in this transaction.
        if (!had && next.includes("do_not_contact")) onClientWrote(tx, { project: c.project, clientId, reason: "opted_out", at: new Date().toISOString() });
        return true;
      });
    },

    /** The client id for an address in a project (the gate ties log events to it), or undefined. */
    async idByEmail(project: string, email: string): Promise<number | undefined> {
      return db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.project, project), eq(clients.email, email.toLowerCase())))
        .get()?.id;
    },

    /** One client of a project (id, name, primary address), or null: the id of another project is not found. */
    async get(project: string, id: number): Promise<{ id: number; name: string; email: string } | null> {
      return (
        db
          .select({ id: clients.id, name: clients.name, email: clients.email })
          .from(clients)
          .where(and(eq(clients.project, project), eq(clients.id, id)))
          .get() ?? null
      );
    },

    /**
     * Up to `limit` clients whose name or address contains `q` (two or more characters, case-insensitive), by name: the link
     * picker of Messengers ▸ Settings (P71 M3). A lookup, never a list of every client row (`app/@rules/README.md` rule 16).
     */
    async search(project: string, q: string, limit = 8): Promise<{ id: number; name: string; email: string }[]> {
      const term = q.trim().toLowerCase();
      if (term.length < 2) return [];
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return db
        .select({ id: clients.id, name: clients.name, email: clients.email })
        .from(clients)
        .where(and(eq(clients.project, project), or(sql`lower(${clients.name}) like ${like} escape '\\'`, sql`lower(${clients.email}) like ${like} escape '\\'`)))
        .orderBy(asc(clients.name), asc(clients.id))
        .limit(Math.min(Math.max(limit, 1), 20))
        .all();
    },

    /** One client of a project with its marks and reply state, or null (P51: `hub mcp` `client_show`). Read only. */
    async card(project: string, id: number): Promise<{ id: number; name: string; email: string; repliesOwed: boolean; lastContactAt: string | null; marks: Mark[] } | null> {
      const c = db.select().from(clients).where(and(eq(clients.project, project), eq(clients.id, id))).get();
      if (!c) return null;
      const m = db.select({ mark: marks.mark }).from(marks).where(eq(marks.clientId, id)).all().map((r) => r.mark);
      return { id: c.id, name: c.name, email: c.email, repliesOwed: c.repliesOwed, lastContactAt: c.lastContactAt, marks: m };
    },

    /**
     * P90: the client's Notion stamp written by another person (`Last sent at` / `Last sent by`), as Sent detection read it;
     * null clears it. Writes only on a change.
     */
    async setTeamSent(id: number, stamp: { at: string; by: string } | null): Promise<boolean> {
      return write(db, (tx) => {
        const c = tx.select({ at: clients.teamSentAt, by: clients.teamSentBy }).from(clients).where(eq(clients.id, id)).get();
        const at = stamp?.at ?? null, by = stamp ? stamp.by.slice(0, 200) : null;
        if (!c || (c.at === at && c.by === by)) return false;
        return tx.update(clients).set({ teamSentAt: at, teamSentBy: by }).where(eq(clients.id, id)).run().changes > 0;
      });
    },

    async isEmpty(): Promise<boolean> {
      return db.select({ id: clients.id }).from(clients).limit(1).get() === undefined;
    },
  };
}
