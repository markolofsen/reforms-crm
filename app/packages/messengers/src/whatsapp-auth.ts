import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { storeToken } from "@hub/connections";

/**
 * The auth state of a WhatsApp linked device (P71 M5, decision 0036 point 5): Baileys' creds and Signal keys, each one file in
 * `state/secrets/sessions/whatsapp-<number>/` (the folder 0700, every file 0600, written atomically by `storeToken`), never in
 * `app.db`, never logged, never backed up (`hub backup` copies only the names under `state/secrets/`). Recovery is a new QR scan.
 *
 * This file never imports Baileys: it holds serialized strings (Baileys' `BufferJSON` is applied in `whatsapp-api.ts`), so the
 * pairing flow and the tests run on it with a fake socket. During a pairing the store has no folder and lives in memory only; the
 * first write to disk is `persistTo`, once the phone has scanned the code and the account's number is known.
 */

export const CREDS = "creds";
const CREDS_FILE = "creds.json";
const ACCOUNT = /^\d{1,20}$/;

/** A key's file: `key.<type>.<id in base64url>.json`, since Baileys' ids hold `:` and `@`. */
const fileOf = (name: string): string => {
  if (name === CREDS) return CREDS_FILE;
  const dot = name.indexOf("/");
  if (dot <= 0) throw new Error("not a key name");
  const type = name.slice(0, dot);
  if (!/^[a-z][a-z-]*$/.test(type)) throw new Error("not a key type");
  return `key.${type}.${Buffer.from(name.slice(dot + 1), "utf8").toString("base64url")}.json`;
};

export const waFolderOf = (dir: string, account: string): string => {
  if (!ACCOUNT.test(account)) throw new Error("not a WhatsApp account number");
  return join(dir, `whatsapp-${account}`);
};

/** A key's store name: its Baileys type and id. */
export const keyName = (type: string, id: string): string => `${type}/${id}`;

export class WaAuthFiles {
  private readonly cache = new Map<string, string | null>();
  private folder: string | null;

  constructor(folder: string | null = null) {
    this.folder = folder;
  }

  /** Where the files are, or null while a pairing has not been scanned yet. */
  get location(): string | null {
    return this.folder;
  }

  get(name: string): string | undefined {
    if (this.cache.has(name)) return this.cache.get(name) ?? undefined;
    if (!this.folder) return undefined;
    const p = join(this.folder, fileOf(name));
    const v = existsSync(p) ? readFileSync(p, "utf8").trim() : null;
    this.cache.set(name, v);
    return v ?? undefined;
  }

  /** Writes one value (null deletes it): to the folder when there is one, always to the in-memory copy. */
  set(name: string, value: string | null): void {
    const file = fileOf(name);
    this.cache.set(name, value);
    if (!this.folder) return;
    if (value === null) rmSync(join(this.folder, file), { force: true });
    else storeToken(this.folder, file, value);
  }

  /** The pairing's end: every value held in memory goes to the account's folder, and later writes go there too. */
  persistTo(folder: string): void {
    this.folder = folder;
    for (const [name, v] of this.cache) if (v !== null) storeToken(folder, fileOf(name), v);
  }
}

export type WaAuthRead = { state: "stored"; auth: WaAuthFiles } | { state: "missing" } | { state: "unsafe-mode" } | { state: "malformed" };

/** One account's stored auth state, or why there is none. A folder or a file readable by others is refused, not used. */
export function readWaAuth(dir: string, account: string): WaAuthRead {
  const folder = waFolderOf(dir, account);
  const creds = join(folder, CREDS_FILE);
  if (!existsSync(creds)) return { state: "missing" };
  if (statSync(folder).mode & 0o077) return { state: "unsafe-mode" };
  for (const f of readdirSync(folder)) if (statSync(join(folder, f)).mode & 0o077) return { state: "unsafe-mode" };
  try {
    const v: unknown = JSON.parse(readFileSync(creds, "utf8"));
    if (typeof v !== "object" || v === null) return { state: "malformed" };
  } catch {
    return { state: "malformed" };
  }
  return { state: "stored", auth: new WaAuthFiles(folder) };
}
