import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface CopyCheck {
  /** `PRAGMA integrity_check` of the copy: "ok" or the first problem. */
  integrity: string;
  tables: number;
  rows: number;
  bytes: number;
}

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
    for (const n of names) rows += (db.prepare(`select count(*) as n from "${n.replace(/"/g, '""')}"`).get() as { n: number }).n;
    return { integrity, tables: names.length, rows, bytes: statSync(copy).size };
  } finally {
    db.close();
  }
}
