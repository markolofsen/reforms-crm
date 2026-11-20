import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import { redact as redactSecrets, storeToken } from "@hub/connections";
import type { MessengerChannel } from "@hub/db";

/**
 * Sessions of the user accounts (decision 0036 point 5): `state/secrets/sessions/<channel>-<account>/session`, mode 0600 in a 0700
 * folder, never in `app.db`, never logged, never backed up (`hub backup` copies only the names under `state/secrets/`). Recovery is
 * a new login. The file holds the mtcute session string and the app's `api_id` and `api_hash`, which mtcute needs on every
 * connect: nothing of the login itself (phone, code, password) is ever written.
 */

export interface UserSession {
  apiId: number;
  apiHash: string;
  session: string;
}

export const SESSION_FILE = "session";
const ACCOUNT = /^\d{1,20}$/;

/** `<home>/state/secrets/sessions` (`HUB_CONFIG_DIR` overrides the secrets folder). */
export const sessionsDir = (env: NodeJS.ProcessEnv = process.env): string => join(hubPaths({ env }).secrets, "sessions");

const folderOf = (dir: string, channel: MessengerChannel, account: string): string => {
  if (!ACCOUNT.test(account)) throw new Error("not an account id");
  return join(dir, `${channel}-${account}`);
};

/** Writes one account's session atomically (mode 0600). Returns the folder (a location, not a secret). */
export function writeSession(dir: string, channel: MessengerChannel, account: string, s: UserSession): string {
  const folder = folderOf(dir, channel, account);
  storeToken(folder, SESSION_FILE, JSON.stringify({ apiId: s.apiId, apiHash: s.apiHash, session: s.session }));
  return folder;
}

const isSession = (v: unknown): v is UserSession =>
  typeof v === "object" && v !== null && typeof Reflect.get(v, "apiId") === "number" && typeof Reflect.get(v, "apiHash") === "string" && typeof Reflect.get(v, "session") === "string";

export type SessionRead = { state: "stored"; session: UserSession } | { state: "missing" } | { state: "unsafe-mode" } | { state: "malformed" };

/** One account's session, or why there is none. A file readable by others is refused, not used. */
export function readSession(dir: string, channel: MessengerChannel, account: string): SessionRead {
  const file = join(folderOf(dir, channel, account), SESSION_FILE);
  if (!existsSync(file)) return { state: "missing" };
  if (statSync(file).mode & 0o077) return { state: "unsafe-mode" };
  try {
    const v: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isSession(v) ? { state: "stored", session: v } : { state: "malformed" };
  } catch {
    return { state: "malformed" };
  }
}

/** The accounts of a channel that have a session folder, in id order. */
export function sessionAccounts(dir: string, channel: MessengerChannel): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const prefix = `${channel}-`;
  return names
    .filter((n) => n.startsWith(prefix) && ACCOUNT.test(n.slice(prefix.length)))
    .map((n) => n.slice(prefix.length))
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
}

/** Disconnect: removes the account's session folder. True when one was there. */
export function removeSession(dir: string, channel: MessengerChannel, account: string): boolean {
  const folder = folderOf(dir, channel, account);
  if (!existsSync(folder)) return false;
  rmSync(folder, { recursive: true, force: true });
  return true;
}

/** Removes every session value of the folder (and every token shape) from a text before it is shown, thrown or logged. */
export function redactSessions(dir: string, text: string): string {
  let out = text;
  for (const ch of ["telegram_user", "whatsapp"] as const)
    for (const a of sessionAccounts(dir, ch)) {
      const r = readSession(dir, ch, a);
      if (r.state === "stored") for (const v of [r.session.session, r.session.apiHash]) if (v.length >= 8) out = out.split(v).join("***");
    }
  return redactSecrets(dir, out);
}
