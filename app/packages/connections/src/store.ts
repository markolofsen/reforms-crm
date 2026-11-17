import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CREDS_FILE, parseAccount } from "@hub/mail/imap";
import { SAFE_FILE, TELEGRAM_IN_TEXT, slug } from "./kinds.js";

/** What is on disk for one secret file. Never the value. */
export type FileState =
  | { state: "missing" }
  | { state: "unsafe-mode"; mode: string; changedAt: string }
  | { state: "empty"; changedAt: string }
  | { state: "stored"; changedAt: string };

const fileOf = (dir: string, file: string): string => {
  if (!SAFE_FILE.test(file) || file.includes("..")) throw new Error("not a plain secret file name");
  return join(dir, file);
};

export function fileState(dir: string, file: string): FileState {
  const p = fileOf(dir, file);
  if (!existsSync(p)) return { state: "missing" };
  const st = statSync(p);
  const changedAt = st.mtime.toISOString();
  if (!st.isFile()) return { state: "empty", changedAt };
  if (st.mode & 0o077) return { state: "unsafe-mode", mode: (st.mode & 0o777).toString(8), changedAt };
  return readFileSync(p, "utf8").trim() ? { state: "stored", changedAt } : { state: "empty", changedAt };
}

/** The value of a token file, for a probe or a reader. `undefined` when missing, empty or readable by others. Never log or return it to a client. */
export function readValue(dir: string, file: string): string | undefined {
  return fileState(dir, file).state === "stored" ? readFileSync(fileOf(dir, file), "utf8").trim() : undefined;
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** Writes `text` to `<dir>/<file>` as mode 600 in a 700 folder: to a temp name first, then renamed, so a reader never sees half a secret. */
function writeAtomic(dir: string, file: string, text: string): string {
  const p = fileOf(dir, file);
  ensureDir(dir);
  const tmp = join(dir, `.${file}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, text, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, p);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new Error(`could not write ${file} (${e instanceof Error ? e.name : "error"})`);
  }
  return p;
}

/** Stores one token alone in its file. Returns the file path (a location, not a secret). */
export const storeToken = (dir: string, file: string, value: string): string => writeAtomic(dir, file, value.trim() + "\n");

/** Deletes one secret file. True when a file was there. */
export function removeSecret(dir: string, file: string): boolean {
  const p = fileOf(dir, file);
  if (!existsSync(p)) return false;
  rmSync(p);
  return true;
}

export interface MailLoginFields { account: string; host: string; port: number; user: string; password: string }

/** The file name of an account's login. */
export const mailFileOf = (account: string): string => `mail-${slug(account)}.json`;

/**
 * Stores an IMAP app-password login as `mail-<slug>.json`. The fields go through the same parser the reader uses, so a file that would be
 * refused later is refused now. `replace: false` never overwrites an existing login (the wizard's rule); the panel passes `true` for Replace.
 */
export function storeMailLogin(dir: string, f: MailLoginFields, o: { replace: boolean }): { file: string } {
  parseAccount(JSON.stringify({ account: f.account, host: f.host, port: f.port, user: f.user, pass: f.password }));
  const file = mailFileOf(f.account);
  if (!o.replace && existsSync(fileOf(dir, file))) throw new Error(`${file} already exists; a login is only replaced on purpose`);
  writeAtomic(dir, file, JSON.stringify({ account: f.account, host: f.host, port: f.port, user: f.user, pass: f.password }, null, 2) + "\n");
  return { file };
}

/** Every secret value on disk, for redaction: token files as a whole, mail logins by their pass or token. */
function knownValues(dir: string): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const out: string[] = [];
  for (const n of names) {
    if (!SAFE_FILE.test(n)) continue;
    try {
      const text = readFileSync(join(dir, n), "utf8");
      if (CREDS_FILE.test(n)) {
        const a = parseAccount(text);
        const v = "pass" in a.auth ? a.auth.pass : a.auth.accessToken;
        if (v.length >= 4) out.push(v);
      } else if (text.length < 4096 && text.trim().length >= 8) out.push(text.trim());
    } catch { /* unreadable or malformed: nothing to learn */ }
  }
  return out;
}

/** Removes every secret value of the folder, and anything shaped like a known token, from a text before it is shown, thrown or logged. */
export function redact(dir: string, text: string): string {
  let out = text;
  for (const v of knownValues(dir)) out = out.split(v).join("***");
  return out.replace(/\b(sk-ant-[A-Za-z0-9_-]{6,}|ntn_[A-Za-z0-9]{6,}|secret_[A-Za-z0-9]{10,})\b/g, "***").replace(TELEGRAM_IN_TEXT, "***");
}
