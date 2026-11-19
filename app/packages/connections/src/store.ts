import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAFE_FILE, TELEGRAM_IN_TEXT } from "./kinds";

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

/** Every secret value on disk, for redaction: each token file as a whole. */
function knownValues(dir: string): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const out: string[] = [];
  for (const n of names) {
    if (!SAFE_FILE.test(n)) continue;
    try {
      const text = readFileSync(join(dir, n), "utf8");
      if (text.length < 4096 && text.trim().length >= 8) out.push(text.trim());
    } catch { /* unreadable: nothing to learn */ }
  }
  return out;
}

/** Removes every secret value of the folder, and anything shaped like a known token, from a text before it is shown, thrown or logged. */
export function redact(dir: string, text: string): string {
  let out = text;
  for (const v of knownValues(dir)) out = out.split(v).join("***");
  return out.replace(TOKEN_SHAPES, "***").replace(BEARER, "$1***").replace(TELEGRAM_IN_TEXT, "***");
}

/**
 * Shapes of credentials that may pass through a text the hub keeps (P54: the agent session log): Anthropic, OpenAI and
 * similar `sk-` keys, Notion, GitHub, Slack, AWS access key ids and JWTs. A shape, not a value: a false positive costs
 * a word in a log, a miss costs a key.
 */
const TOKEN_SHAPES = /\b(sk-ant-[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9_-]{20,}|ntn_[A-Za-z0-9]{6,}|secret_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
/** An `Authorization: Bearer <token>` value (the scheme word is kept). */
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi;
