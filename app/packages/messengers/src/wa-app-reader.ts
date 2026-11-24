import { openSync, closeSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import type * as NodeSqlite from "node:sqlite";
import type { InboundMessage } from "./adapter";
import type { WaAddress } from "./whatsapp-socket";

/**
 * The WhatsApp app's own database on the owner's Mac, as a read-only refill of one chat (decision 0049 points 3 to 5, P141 W3).
 * WhatsApp keeps no server-side history a linked device may read, but the Mac's WhatsApp app (a Core Data SQLite file, not
 * encrypted) holds every chat the phone synced to it. The Hub opens it with `readOnly`, never writes it, and reads one chat at a
 * time: on link, on open and on Refresh. A row's `ZSTANZAID` is WhatsApp's message id, the same `remote_message_id` Baileys gives,
 * so a message the receiver already cached is not stored twice.
 *
 * It fails closed (0049 point 4): at open, a probe checks `Z_METADATA` and the columns named below; on any mismatch, or when macOS
 * refuses the process, the reader is off and says why and the one fix. It never guesses a column. A message type it does not know
 * (a call, a system line, a deleted message, anything new) is skipped, never stored as a guess. Nothing here logs a jid or a text.
 *
 * The schema is WhatsApp's private one (`Z_METADATA` version 1 on 2026-11-24, app 26.44.72): `ZWACHATSESSION` holds a chat
 * (`ZCONTACTJID` is the address it is filed under, `@lid` or the phone's; `ZCONTACTIDENTIFIER` the other one; `ZSESSIONTYPE` 0 a
 * private chat) and `ZWAMESSAGE` its messages (`ZMESSAGEDATE` in seconds since 2001-01-01).
 */

/** Where the WhatsApp app for Mac keeps its chats. */
export const WA_APP_DB = join(homedir(), "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite");

/** The one fix line when macOS refuses the server's process (0049 point 4): the owner grants it; the agent never does. */
export const WA_APP_FIX = (execPath: string): string =>
  `Grant Full Disk Access to ${execPath} (System Settings ▸ Privacy & Security ▸ Full Disk Access), then restart the Hub.`;

/** Core Data's epoch, 2001-01-01T00:00:00Z, in Unix seconds. */
export const CORE_DATA_EPOCH_S = 978_307_200;

/** The columns this reader reads; the probe refuses a database that lacks one. */
export const WA_APP_COLUMNS = {
  ZWACHATSESSION: ["Z_PK", "ZSESSIONTYPE", "ZCONTACTJID", "ZCONTACTIDENTIFIER", "ZPARTNERNAME", "ZLASTMESSAGEDATE"],
  ZWAMESSAGE: ["Z_PK", "ZCHATSESSION", "ZISFROMME", "ZMESSAGETYPE", "ZMESSAGEDATE", "ZTEXT", "ZSTANZAID"],
} as const;

/** `ZMESSAGETYPE` → the kind stored. Only these are read; 0 is text and 7 a text with a link preview. */
export const WA_APP_KINDS: Readonly<Record<number, string>> = { 0: "text", 7: "text", 1: "image", 2: "video", 3: "audio", 4: "contact", 5: "location", 8: "document", 11: "video", 15: "sticker" };

/** A chat's read is bounded: a link imports 30 days, and the phone's own history request asks for 500 at most. */
export const WA_APP_LIMIT = 500;

export type WaAppState =
  | { state: "on" }
  | {
      state: "off";
      /** `missing`: no WhatsApp app database on this Mac; `refused`: macOS refused the process; `schema`: the app changed its database. */
      reason: "missing" | "refused" | "schema" | "error";
      /** One sentence for the owner (Settings ▸ WhatsApp, the doctor). */
      detail: string;
      /** The one line that turns it on, when the owner can. */
      fix: string | null;
    };

/** A private chat the app holds, for the seed of the known chats (P141 U2): its chat id, its real address and the name the app shows. */
export interface WaAppSession {
  chatId: string;
  jid: string;
  name: string | null;
}

export interface WaAppReader {
  state(): WaAppState;
  /** The private chats with a message since `since`, newest first, at most `limit` (never a text); none when off. */
  recent(since: Date, limit: number): WaAppSession[];
  /** One chat's messages since `since`, oldest first, as ingest takes them (`source: "wa_app"`); none when off or not found. */
  read(chat: WaAddress, since: Date, account: string): InboundMessage[];
}

type Sqlite = typeof NodeSqlite;
type Row = Record<string, unknown>;

/** `node:sqlite` is loaded on first use only, so a process that never reads the app does not load it. */
const sqlite = (): Sqlite => createRequire(import.meta.url)("node:sqlite") as Sqlite;

const refusedCode = (e: unknown): boolean => typeof e === "object" && e !== null && "code" in e && (e.code === "EPERM" || e.code === "EACCES");

/** The addresses a chat may be filed under in the app: its phone JID and its LID, either as the chat's JID or as its identifier. */
function addressesOf(chat: WaAddress): string[] {
  const out = new Set<string>();
  if (chat.chatId.startsWith("lid:")) out.add(`${chat.chatId.slice(4)}@lid`);
  else if (/^\+\d{7,15}$/.test(chat.chatId)) out.add(`${chat.chatId.slice(1)}@s.whatsapp.net`);
  if (chat.jid && /^\d{1,20}@(lid|s\.whatsapp\.net)$/.test(chat.jid)) out.add(chat.jid);
  return [...out];
}

export function openWaAppReader(o: { path?: string; execPath?: string } = {}): WaAppReader {
  const path = o.path ?? WA_APP_DB;
  const fix = WA_APP_FIX(o.execPath ?? process.execPath);
  const open = () => new (sqlite().DatabaseSync)(path, { readOnly: true });

  const probe = (): WaAppState => {
    if (!existsSync(path)) return { state: "off", reason: "missing", detail: "The WhatsApp app for Mac is not installed or not linked on this Mac: history comes only from messages received while the Hub runs.", fix: null };
    try {
      // A plain open tells a macOS refusal (EPERM) from anything SQLite says.
      closeSync(openSync(path, "r"));
    } catch (e) {
      if (refusedCode(e)) return { state: "off", reason: "refused", detail: "macOS refused the Hub's server access to the WhatsApp app's database: history comes only from messages received while the Hub runs.", fix };
      return { state: "off", reason: "error", detail: `The WhatsApp app's database cannot be opened (${e instanceof Error ? e.name : "error"}).`, fix: null };
    }
    let db: InstanceType<Sqlite["DatabaseSync"]> | null = null;
    try {
      db = open();
      const meta = db.prepare("select count(*) as n from sqlite_master where type = 'table' and name = 'Z_METADATA'").get() as Row | undefined;
      if (Number(meta?.n ?? 0) !== 1) return { state: "off", reason: "schema", detail: "The WhatsApp app's database has no Z_METADATA: its format changed, so the Hub does not read it.", fix: null };
      for (const [table, cols] of Object.entries(WA_APP_COLUMNS)) {
        const have = new Set((db.prepare(`pragma table_info(${table})`).all() as Row[]).map((r) => String(r.name)));
        const missing = cols.filter((c) => !have.has(c));
        if (missing.length) return { state: "off", reason: "schema", detail: `The WhatsApp app's database changed (${table} lacks ${missing.join(", ")}), so the Hub does not read it.`, fix: null };
      }
      return { state: "on" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (refusedCode(e) || /authori[sz]ation denied|not permitted/i.test(msg)) return { state: "off", reason: "refused", detail: "macOS refused the Hub's server access to the WhatsApp app's database: history comes only from messages received while the Hub runs.", fix };
      return { state: "off", reason: "error", detail: `The WhatsApp app's database cannot be read (${e instanceof Error ? e.name : "error"}).`, fix: null };
    } finally {
      db?.close();
    }
  };

  const state = probe();

  return {
    state: () => state,
    recent(since, limit) {
      if (state.state !== "on") return [];
      const db = open();
      try {
        const sinceCd = since.getTime() / 1000 - CORE_DATA_EPOCH_S;
        const rows = db
          .prepare(`select ZCONTACTJID as jid, ZCONTACTIDENTIFIER as other, ZPARTNERNAME as name from ZWACHATSESSION where ZSESSIONTYPE = 0 and ZLASTMESSAGEDATE >= ? order by ZLASTMESSAGEDATE desc limit ${Math.max(1, Math.min(500, Math.floor(limit)))}`)
          .all(sinceCd) as Row[];
        const out: WaAppSession[] = [];
        for (const r of rows) {
          const jid = typeof r.jid === "string" ? r.jid : "";
          const other = typeof r.other === "string" ? r.other : "";
          // The chat id is the phone when either address names it, else the LID (P141 verdict 5: never a guessed number).
          const phone = /^(\d{7,15})@s\.whatsapp\.net$/.exec(jid)?.[1] ?? /^(\d{7,15})@s\.whatsapp\.net$/.exec(other)?.[1] ?? null;
          const lid = /^(\d{1,20})@lid$/.exec(jid)?.[1] ?? null;
          const chatId = phone ? `+${phone}` : lid ? `lid:${lid}` : null;
          if (!chatId) continue;
          out.push({ chatId, jid, name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : null });
        }
        return out;
      } finally {
        db.close();
      }
    },
    read(chat, since, account) {
      if (state.state !== "on") return [];
      const addresses = addressesOf(chat);
      if (!addresses.length) return [];
      const db = open();
      try {
        const marks = addresses.map(() => "?").join(", ");
        const sessions = (db.prepare(`select Z_PK as pk from ZWACHATSESSION where ZSESSIONTYPE = 0 and (ZCONTACTJID in (${marks}) or ZCONTACTIDENTIFIER in (${marks}))`).all(...addresses, ...addresses) as Row[]).map((r) => Number(r.pk));
        if (!sessions.length) return [];
        const sinceCd = since.getTime() / 1000 - CORE_DATA_EPOCH_S;
        const rows = db
          .prepare(`select ZISFROMME as fromMe, ZMESSAGETYPE as type, ZMESSAGEDATE as at, ZTEXT as text, ZSTANZAID as id from ZWAMESSAGE where ZCHATSESSION in (${sessions.map(() => "?").join(", ")}) and ZMESSAGEDATE >= ? and ZSTANZAID is not null order by ZMESSAGEDATE desc limit ${WA_APP_LIMIT}`)
          .all(...sessions, sinceCd) as Row[];
        const out: InboundMessage[] = [];
        for (const r of rows.reverse()) {
          const kind = WA_APP_KINDS[Number(r.type)];
          if (!kind) continue;
          const text = typeof r.text === "string" ? r.text : "";
          if (kind === "text" && !text) continue;
          const sentAt = new Date((Number(r.at) + CORE_DATA_EPOCH_S) * 1000).toISOString();
          out.push({ channel: "whatsapp", account, chatId: chat.chatId, remoteMessageId: String(r.id), kind, text, sentAt, direction: Number(r.fromMe) === 1 ? "out" : "in", source: "wa_app" });
        }
        return out;
      } finally {
        db.close();
      }
    },
  };
}
