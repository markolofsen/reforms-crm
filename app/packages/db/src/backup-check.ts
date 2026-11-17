import Database from "better-sqlite3";
import { copyFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "./client";

export interface CopyCheck {
  /** `PRAGMA integrity_check` of the copy: "ok" or the first problem. */
  integrity: string;
  tables: number;
  rows: number;
  /** Rows without the migration ledger (`__drizzle_migrations`), which grows when a migration is applied. */
  dataRows: number;
  bytes: number;
}

const LEDGER = "__drizzle_migrations";

/**
 * The doctor's backup proof for the app database: open the live file READ-ONLY, `VACUUM INTO` a copy inside `tmpDir`,
 * open the copy read-only, run the integrity check and count its rows. The live file is never written (no migration, no
 * WAL checkpoint by us); the caller owns `tmpDir` and removes it (`fileName` names the copy; `hub backup` keeps it as `app.db`). Throws when the file is missing or cannot be copied.
 */
export function copyAndVerify(source: string, tmpDir: string, fileName = "app-copy.db"): CopyCheck {
  if (!existsSync(source)) throw new Error(`${source} does not exist`);
  const copy = join(tmpDir, fileName);
  const live = new Database(source, { readonly: true, fileMustExist: true });
  try {
    live.pragma("busy_timeout = 5000");
    live.prepare("VACUUM INTO ?").run(copy);
  } finally {
    live.close();
  }
  return inspectCopy(copy);
}

/** Open a copy READ-ONLY, run `PRAGMA integrity_check`, count tables and rows. Used on a fresh copy and on a snapshot's `data/app.db` (`hub backup --verify`). */
export function inspectCopy(copy: string): CopyCheck {
  const db = new Database(copy, { readonly: true, fileMustExist: true });
  try {
    const integrity = String(db.pragma("integrity_check", { simple: true }));
    const names = (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
    let rows = 0;
    let dataRows = 0;
    for (const n of names) {
      const c = (db.prepare(`select count(*) as n from "${n.replace(/"/g, '""')}"`).get() as { n: number }).n;
      rows += c;
      if (n !== LEDGER) dataRows += c;
    }
    return { integrity, tables: names.length, rows, dataRows, bytes: statSync(copy).size };
  } finally {
    db.close();
  }
}

export interface RestoreCheck {
  /** The copy as it sits in the snapshot, read before any migration. Compare it with what the manifest recorded. */
  before: CopyCheck;
  /** The same copy after the current migrations were applied to it (what the app does on its first start after a restore). */
  after: CopyCheck;
  /** Migrations the current core applied on top of the snapshot's schema (0 for a snapshot of the same core). */
  migrationsApplied: number;
}

/**
 * Restore a snapshot's database the way a person would: copy it into `tmpDir`, open it with `openDb` (WAL, foreign keys and every
 * migration the current core has) and run the integrity check and the counts again. Proves the file opens, migrates forward and
 * keeps its rows. Nothing but `tmpDir` is written; the snapshot and the live database are never touched. The caller owns `tmpDir`.
 * Throws when the copy cannot be opened or a migration fails.
 */
export function restoreCheck(snapshotDb: string, tmpDir: string): RestoreCheck {
  const copy = join(tmpDir, "restored.db");
  copyFileSync(snapshotDb, copy);
  const before = inspectCopy(copy);
  if (before.integrity !== "ok") return { before, after: before, migrationsApplied: 0 };
  const ledger = (c: CopyCheck) => c.rows - c.dataRows;
  openDb(copy).close();
  const after = inspectCopy(copy);
  return { before, after, migrationsApplied: ledger(after) - ledger(before) };
}
