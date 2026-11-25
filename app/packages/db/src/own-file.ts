import Database from "better-sqlite3";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { errFields, ops } from "@hub/log/ops";
import { DbBehindError } from "./client";

/**
 * A feature's own database file (research 26 section 1.5, P144 W3, shared with P79 T1): the same pragmas as `app.db` (WAL,
 * busy_timeout, foreign keys) and its own migration chain, so a failing migration of the feature stops that feature, never the
 * server or `app.db`. Migrations are the feature's hand-written `NNNN_name.sql` files in one folder, applied in name order and
 * recorded in the file's own `_migrations` table. As with `app.db` (P141's guard), only the server migrates an existing file:
 * any other opener refuses one that is behind (`DbBehindError`). A new file (nothing applied yet) is always migrated.
 */

export type SqliteClient = Database.Database;

export interface OwnFileHandle {
  client: SqliteClient;
  close: () => void;
  /** Migrations this code ships that the file has not applied (0 when current). */
  behind: () => number;
}

const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/** The folder's migrations, in name order. */
export const migrationsIn = (folder: string): string[] => readdirSync(folder).filter((f) => NAME.test(f)).sort();

const applied = (c: SqliteClient): Set<string> => {
  c.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)");
  const rows: unknown[] = c.prepare("SELECT name FROM _migrations").all();
  return new Set(rows.flatMap((r) => (r && typeof r === "object" && "name" in r && typeof r.name === "string" ? [r.name] : [])));
};

export function openOwnFile(path: string, o: { migrationsFolder: string; migrate?: boolean; label: string }): OwnFileHandle {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path);
  client.pragma("journal_mode = WAL");
  client.pragma("busy_timeout = 5000");
  client.pragma("foreign_keys = ON");
  client.pragma("synchronous = NORMAL");
  const shipped = migrationsIn(o.migrationsFolder);
  const done = applied(client);
  const pending = shipped.filter((f) => !done.has(f));
  if (done.size > 0 && pending.length > 0 && !o.migrate) {
    client.close();
    throw new DbBehindError(path, pending.length);
  }
  for (const f of pending) {
    try {
      client.transaction(() => {
        client.exec(readFileSync(join(o.migrationsFolder, f), "utf8"));
        client.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(f, new Date().toISOString());
      })();
    } catch (e) {
      ops("db").error("a database migration failed", { db: o.label, migration: f, ...errFields(e, true) });
      client.close();
      throw e;
    }
  }
  if (pending.length > 0 && path !== ":memory:") ops("db").info("database migrations applied", { db: o.label, applied: pending.length, total: shipped.length });
  return { client, close: () => client.close(), behind: () => Math.max(0, shipped.length - applied(client).size) };
}

/** Another program's SQLite file, read only (the watcher's import of an experiment's database): no pragma, no migration. */
export function openSqliteReadOnly(path: string): { client: SqliteClient; close: () => void } {
  const client = new Database(path, { readonly: true, fileMustExist: true });
  return { client, close: () => client.close() };
}
