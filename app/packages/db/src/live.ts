import Database from "better-sqlite3";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./client";
import * as schema from "./schema";
import { write } from "./tx";

// Live panels (P50, migration 0019): every write to a table runs a trigger that bumps `live_seq.n` and records
// (table, project, n) in `live_versions`, in the writer's own transaction. The server tails these two tables and tells
// the admin which topics moved. State that is not a row (the Connections files, the health of the pollers) is bumped
// with `bumpTopic`, which takes the same path.

/** The SQL name of every table in `schema.ts`: the server's `Record<LiveTable, LiveTopic>` fails `tsc` on a new one. */
export type LiveTable = { [K in keyof typeof schema]: (typeof schema)[K] extends { _: { name: infer N extends string } } ? N : never }[keyof typeof schema];

/** The same names at run time (the triggers test checks each has its three triggers). */
export const LIVE_TABLES: string[] = Object.values(schema).flatMap((v) => (is(v, SQLiteTable) ? [getTableName(v)] : []));

/** A bump that is not a table row: stored as `topic:<name>` so it never collides with a table. */
export const TOPIC_PREFIX = "topic:";

/** One moved source: a table name or `topic:<name>`, the project ('' for the whole instance), and the counter it moved at. */
export type LiveChange = { tbl: string; project: string; seq: number };

/** The counter now. One page read; the server polls it every 200 ms. */
export function liveSeq(db: Db): number {
  const row: unknown = db.$client.prepare("SELECT n FROM live_seq WHERE id = 1").get();
  return typeof row === "object" && row !== null && "n" in row && typeof row.n === "number" ? row.n : 0;
}

/** Everything that moved after `seq` (exclusive), and the counter it was read at. Read in one transaction, so the two agree. */
export function liveSince(db: Db, seq: number): { seq: number; changes: LiveChange[] } {
  const read = db.$client.transaction(() => {
    const now = liveSeq(db);
    const rows = db.$client.prepare("SELECT tbl, project, seq FROM live_versions WHERE seq > ? ORDER BY seq").all(seq);
    const changes: LiveChange[] = [];
    for (const r of rows) {
      if (typeof r === "object" && r !== null && "tbl" in r && "project" in r && "seq" in r && typeof r.tbl === "string" && typeof r.project === "string" && typeof r.seq === "number") {
        changes.push({ tbl: r.tbl, project: r.project, seq: r.seq });
      }
    }
    return { seq: now, changes };
  });
  return read();
}

/** Record that a topic moved for a project (or the instance with `null`), as if a row of it had been written. */
export function bumpTopic(db: Db, topic: string, project: string | null): number {
  return write(db, () => {
    const c = db.$client;
    c.prepare("UPDATE live_seq SET n = n + 1 WHERE id = 1").run();
    const n = liveSeq(db);
    c.prepare("INSERT INTO live_versions (tbl, project, seq) VALUES (?, ?, ?) ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq").run(`${TOPIC_PREFIX}${topic}`, project ?? "", n);
    return n;
  });
}

/**
 * `bumpTopic` for a process that holds the database read-only (`hub mcp`, P53): a short connection that may write only
 * the live counter, opened and closed for this one bump, with no migration. The file must exist.
 */
export function bumpTopicIn(path: string, topic: string, project: string | null): number {
  const c = new Database(path, { fileMustExist: true });
  try {
    c.pragma("busy_timeout = 2000");
    return c
      .transaction(() => {
        c.prepare("UPDATE live_seq SET n = n + 1 WHERE id = 1").run();
        const row: unknown = c.prepare("SELECT n FROM live_seq WHERE id = 1").get();
        const n = typeof row === "object" && row !== null && "n" in row && typeof row.n === "number" ? row.n : 0;
        c.prepare("INSERT INTO live_versions (tbl, project, seq) VALUES (?, ?, ?) ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq").run(`${TOPIC_PREFIX}${topic}`, project ?? "", n);
        return n;
      })
      .immediate();
  } finally {
    c.close();
  }
}
