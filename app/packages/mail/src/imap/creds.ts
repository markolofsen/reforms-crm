import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import type { ImapAccount } from "./session";
import { ADDRESS, normAddr } from "./util";

/**
 * The one folder for every secret of the hub (mail logins, optional tokens): `<home>/state/secrets/`, mode 700, files 600.
 * It sits inside the instance but `state/*` is git-ignored (a test guards that). `HUB_CONFIG_DIR` overrides it.
 * The rule lives in `@hub/config/paths`, one place for every package.
 */
export const secretsDir = (env: NodeJS.ProcessEnv = process.env): string => hubPaths({ env }).secrets;
/** Mail logins are kept in {@link secretsDir}: one `mail-<anything>.json` per account, mode 600. */
export const CREDS_FILE = /^mail-[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

/**
 * File shape (example, not a secret):
 * { "account": "Google", "host": "imap.gmail.com", "port": 993, "user": "me@example.org",
 *   "pass": "<app password>"  OR  "accessToken": "<OAuth2 access token>",
 *   "addresses": ["me@example.org"], "mailboxes": ["INBOX"], "sentMailbox": "[Gmail]/Sent Mail" }
 */
export interface LoadResult {
  accounts: ImapAccount[];
  /** One line per unusable file. Names the file and the reason, never a value. */
  problems: string[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Parses one file's text. Pure; throws a reason without any secret in it. */
export function parseAccount(text: string): ImapAccount {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("not valid JSON");
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("not a JSON object");
  const name = str(j.account);
  const host = str(j.host);
  const user = str(j.user);
  if (!name) throw new Error('"account" is missing');
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) throw new Error('"host" is missing or not a host name');
  if (!user) throw new Error('"user" is missing');
  const pass = str(j.pass);
  const accessToken = str(j.accessToken);
  if (!pass === !accessToken) throw new Error('exactly one of "pass" and "accessToken" is needed');
  const port = j.port === undefined ? 993 : Number(j.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('"port" is not a port number');
  const list = (v: unknown, field: string): string[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) throw new Error(`"${field}" must be a list of strings`);
    return (v as string[]).map((x) => x.trim());
  };
  const addresses = (list(j.addresses, "addresses") ?? []).map(normAddr);
  const own = normAddr(user);
  if (ADDRESS.test(own) && !addresses.includes(own)) addresses.push(own);
  const bad = addresses.find((a) => !ADDRESS.test(a));
  if (bad) throw new Error('"addresses" holds something that is not an e-mail address');
  const mailboxes = list(j.mailboxes, "mailboxes");
  const sentMailbox = str(j.sentMailbox);
  return {
    name,
    host,
    port,
    secure: j.secure === undefined ? port === 993 : j.secure === true,
    user,
    auth: pass ? { pass } : { accessToken: accessToken as string },
    ...(mailboxes ? { mailboxes } : {}),
    ...(sentMailbox ? { sentMailbox } : {}),
    addresses,
  };
}

/**
 * Reads every `mail-*.json` in `dir`. A file that other users can read (mode not 600) is refused, as are bad ones;
 * both are reported in `problems` and the rest still load. A missing folder is an empty result: mail is simply off.
 * Read it again on every connection: an OAuth access token file is refreshed from outside and expires within the hour.
 */
export function loadAccounts(dir: string = secretsDir()): LoadResult {
  const out: LoadResult = { accounts: [], problems: [] };
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => CREDS_FILE.test(n)).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    const file = join(dir, n);
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error("not a plain file");
      if (st.mode & 0o077) throw new Error(`mode ${(st.mode & 0o777).toString(8)}, must be 600`);
      out.accounts.push(parseAccount(readFileSync(file, "utf8")));
    } catch (e) {
      out.problems.push(`${n}: ${e instanceof Error ? e.message : "unreadable"}`);
    }
  }
  const seen = new Set<string>();
  out.accounts = out.accounts.filter((a) => {
    const k = a.name.toLowerCase();
    if (seen.has(k)) {
      out.problems.push(`${a.name}: two files name this account; the second is ignored`);
      return false;
    }
    seen.add(k);
    return true;
  });
  return out;
}

/** Removes every secret of the given accounts from a text (an error message from the server, say). */
export function redactSecrets(text: string, accounts: ImapAccount[]): string {
  let out = text;
  for (const a of accounts) {
    const s = "pass" in a.auth ? a.auth.pass : a.auth.accessToken;
    if (s.length >= 4) out = out.split(s).join("***");
  }
  return out;
}
