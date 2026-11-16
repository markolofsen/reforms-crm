import type { Db } from "./client";

/** The transaction handle the callback receives. */
export type WriteTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The one way a repository opens a write transaction. It is `BEGIN IMMEDIATE`: the write lock is taken up front, so
 * `busy_timeout` can wait for the other writer process (the server and `hub record-draft` share one WAL file). A
 * deferred transaction that reads first and writes after another process committed fails at once with
 * SQLITE_BUSY_SNAPSHOT, and no timeout retries that.
 */
export function write<T>(db: Db, fn: (tx: WriteTx) => T): T {
  return db.transaction(fn, { behavior: "immediate" });
}

/**
 * SQLite's `data_version` of this connection: it changes whenever ANOTHER connection commits (a `hub record-draft` in
 * a terminal), and not for this connection's own writes. The server hands it to the admin, which refetches on change.
 */
export function dataVersion(db: Db): number {
  const v: unknown = db.$client.pragma("data_version", { simple: true });
  return typeof v === "number" ? v : 0;
}

/** SQLite's "database is locked": another writer held the file for longer than `busy_timeout`. */
export const isBusy = (e: unknown): boolean => typeof e === "object" && e !== null && "code" in e && (e.code === "SQLITE_BUSY" || e.code === "SQLITE_BUSY_SNAPSHOT");
