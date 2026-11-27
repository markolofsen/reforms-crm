import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync, type Stats } from "node:fs";
import path from "node:path";

export const backupHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const missing = (error: unknown): boolean => typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";

/** Snapshot keys and pinned relative files must be canonical, never a URL, scheme, absolute path or traversal. */
export function backupRelative(value: string): string {
  if (!value || value.includes("\0") || value.includes("\\") || path.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Non-canonical public-workflow backup path");
  return value;
}

/** Configured roots are trusted; every existing child component must be regular and remain inside their real root. */
export function backupContained(root: string, relative: string, optional = false): string | null {
  backupRelative(relative);
  let base: string;
  try { base = realpathSync(root); }
  catch (error) { if (optional && missing(error)) return null; throw new Error("Public-workflow backup root is missing or unreadable"); }
  let current = base;
  const parts = relative.split("/");
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    let info: Stats;
    try { info = lstatSync(current); }
    catch (error) { if (optional && missing(error)) return null; throw new Error(`${relative}: missing or unreadable backup input`); }
    if (info.isSymbolicLink()) throw new Error(`${relative}: symbolic links are not backup inputs`);
    if (i < parts.length - 1 && !info.isDirectory()) throw new Error(`${relative}: a parent is not a directory`);
  }
  const actual = realpathSync(current);
  const rel = path.relative(base, actual);
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error("Public-workflow backup input escapes its root");
  return actual;
}

export function backupRead(root: string, relative: string, limit: number, allowEmpty = false): Buffer {
  const file = backupContained(root, relative);
  if (!file) throw new Error(`${relative}: missing backup input`);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || (!allowEmpty && before.size === 0) || before.size > limit) throw new Error(`${relative}: expected a ${allowEmpty ? "" : "nonempty "}regular file of at most ${limit} bytes`);
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const n = readSync(fd, bytes, length, bytes.length - length, length);
      if (!n) break;
      length += n;
    }
    const after = fstatSync(fd);
    const current = backupContained(root, relative);
    if (!current) throw new Error(`${relative}: backup input disappeared`);
    const named = lstatSync(current);
    if (length !== before.size || after.size !== before.size || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs || before.ino !== named.ino || before.dev !== named.dev) throw new Error(`${relative}: changed while being read`);
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}

/** Only the new partial snapshot is written; an existing colliding dump file must already contain the exact same bytes. */
export function backupWrite(stage: string, relative: string, bytes: Buffer, limit: number, allowEmpty = false): void {
  backupRelative(relative);
  let current = realpathSync(stage);
  for (const part of relative.split("/").slice(0, -1)) {
    current = path.join(current, part);
    try { mkdirSync(current, { mode: 0o700 }); }
    catch (error) {
      if (typeof error !== "object" || error === null || Reflect.get(error, "code") !== "EEXIST") throw error;
    }
    const info = lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${relative}: unsafe snapshot destination`);
  }
  const target = path.join(stage, relative);
  try { writeFileSync(target, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (typeof error !== "object" || error === null || Reflect.get(error, "code") !== "EEXIST") throw error;
    if (!backupRead(stage, relative, limit, allowEmpty).equals(bytes)) throw new Error(`${relative}: snapshot destination has conflicting bytes`);
  }
}
