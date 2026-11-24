import { AdapterError } from "./adapter";
import { redact } from "./poller";
import type { WaAuthFiles } from "./whatsapp-auth";

/**
 * What the hub needs of a Baileys socket, and how its closes and errors read (P71 M5). Split from `whatsapp.ts` (P141) so the
 * adapter stays one screen: the real socket is `whatsapp-api.ts`, the fake `fake-wa.ts`, and both satisfy `WaSocket`.
 */

/** Who is signed in: the account is the number's digits (the session folder's name), `name` the owner's WhatsApp name. */
export interface WaMe {
  account: string;
  name: string;
}

/** A message as the hub reads it; `whatsapp-api.ts` maps Baileys' `WAMessage` onto it (none for anything not a person's chat). */
export interface WaMessage {
  id: string;
  /** The chat's number, `+` and digits (`normalizeIdentifier("whatsapp")`), or `lid:<digits>` when WhatsApp hides the number. */
  chatId: string;
  /** The chat's real address (`…@lid` when WhatsApp gives one): what the history request and the send name. */
  jid?: string;
  fromMe: boolean;
  at: Date;
  text: string;
  /** `text` or the media's kind (`image`, `audio`, ...); null for a message with nothing to keep (a reaction, a protocol message). */
  kind: string | null;
  /** The sender's own WhatsApp profile name (`pushName`), on an inbound message: their text, shown as such, never a Notion name. */
  pushName?: string;
  /** An edit of the message with this id: its text replaces the stored one. */
  editOf?: string;
}

export interface WaChat {
  chatId: string;
  name: string | null;
  /** The chat's real address when the event names one (a contact's `@lid` id beside its phone number). */
  jid?: string | null;
}

/** How a request names a chat: the hub's chat id and its real address when known (`whatsapp-api.ts` spells one from the id otherwise). */
export interface WaAddress {
  chatId: string;
  jid: string | null;
}

export type WaConnection =
  | { state: "qr"; qr: string }
  /** The phone has just scanned the code: the creds hold the account now (Baileys then closes with 515, restart required). */
  | { state: "paired"; me: WaMe }
  | { state: "open"; me: WaMe }
  /** `reason`: Baileys' own words and the closing node's tag and attributes (`Stream Errored (conflict): conflict type=device_removed`), redacted; it reaches `last_error`. */
  | { state: "close"; code: number | null; reason?: string | null };

export interface WaEvents {
  connection(u: WaConnection): void;
  /** `history` for a history sync (the first after pairing, or the answer to `requestHistory`), `live` for everything else. */
  messages(ms: WaMessage[], source: "live" | "history"): void;
  chats(cs: WaChat[]): void;
}

/** What the hub needs of one Baileys socket. A socket connects on creation; `listen` is called right after. */
export interface WaSocket {
  listen(e: WaEvents): void;
  /** One plain text to a private chat (P71 M5): only the adapter's `send` calls it, with a confirmed draft. */
  sendText(chat: WaAddress, text: string): Promise<{ id: string; at: Date }>;
  /** Asks the phone for up to `count` messages older than `anchor` in this chat; they arrive as a `history` batch whenever it answers. */
  requestHistory(chat: WaAddress, anchor: WaAnchor, count: number): Promise<void>;
  /** Unlinks the device on WhatsApp's side (it leaves the phone's Linked devices list). */
  logout(): Promise<void>;
  close(): Promise<void>;
}

/** Builds a socket over an auth store: the real one in `whatsapp-api.ts`, `FakeWaSocket` in tests. */
export type WaSocketFactory = (auth: WaAuthFiles) => WaSocket;

/** The key and time of one message of a chat (the history request's anchor): no text. */
export interface WaAnchor {
  id: string;
  fromMe: boolean;
  at: Date;
}

/** How long `start` waits for the socket to open. */
export const WA_OPEN_MS = 60_000;
/**
 * How long a history request stays open (P141 W3b, verdict 2): the phone answers on-demand history whenever it is online, through
 * the receiver; no HTTP request waits for it. Past this, one ops line says the phone did not answer (no jid, no text).
 */
export const WA_HISTORY_MS = 120_000;
/** The directory of private chats the picker reads, newest first; past it the oldest entries go. */
export const WA_DIRECTORY_MAX = 2000;

/** Baileys' `DisconnectReason` codes the mapping reads (`@hapi/boom` status codes). */
export const WA_CODES = { loggedOut: 401, forbidden: 403, connectionReplaced: 440, multideviceMismatch: 411, badSession: 500, restartRequired: 515, timedOut: 408, connectionClosed: 428, unavailable: 503, rateLimited: 429 } as const;

const NETWORK = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|socket|timed? ?out|connection/i;

/** A Boom error's status code, by shape (this file never imports Baileys or Boom). */
const statusOf = (err: unknown): number | null => {
  if (typeof err !== "object" || err === null) return null;
  const output: unknown = Reflect.get(err, "output");
  const code: unknown = typeof output === "object" && output !== null ? Reflect.get(output, "statusCode") : Reflect.get(err, "statusCode");
  return typeof code === "number" ? code : null;
};

/**
 * Maps a close code or a thrown error to an `AdapterError`. The message carries the code only, never a chat, a name or a text: the
 * line reaches `messenger_accounts.last_error` and `/api/health`. 401 (logged out on the phone), 411 and 500 (a session WhatsApp no
 * longer accepts) park the account as `logged_out`; 403 parks it as `banned`; 440 (the session was opened elsewhere) stops it
 * without a park; 429 waits; the rest is the network's, retried with the backoff.
 */
export function toWaAdapterError(err: unknown, closeCode?: number | null, detail?: string | null): AdapterError {
  if (err instanceof AdapterError) return err;
  const code = closeCode ?? statusOf(err);
  if (code !== null && code !== undefined) {
    // WhatsApp's own reason, when the close carried one: what the next 401 says about why.
    const why = detail ? ` [${detail}]` : "";
    if (code === WA_CODES.loggedOut) return new AdapterError("logged_out", `whatsapp 401: logged out (the device was removed or the session ended)${why}`);
    if (code === WA_CODES.multideviceMismatch || code === WA_CODES.badSession) return new AdapterError("logged_out", `whatsapp ${code}: the session is no longer valid${why}`);
    if (code === WA_CODES.forbidden) return new AdapterError("banned", `whatsapp 403: the number is banned or restricted${why}`);
    if (code === WA_CODES.connectionReplaced) return new AdapterError("conflict", `whatsapp 440: the session was opened in another place (connection replaced)${why}`);
    if (code === WA_CODES.rateLimited) return new AdapterError("rate_limited", `whatsapp 429: rate limited${why}`, 60_000);
    return new AdapterError("network", `whatsapp ${code}: the connection closed${why}`);
  }
  const name = err instanceof Error ? err.name : "Error";
  const msg = err instanceof Error ? err.message : String(err);
  if (NETWORK.test(`${name} ${msg}`)) return new AdapterError("network", redact(`${name}: ${msg}`).slice(0, 200));
  return new AdapterError("unknown", name.slice(0, 60));
}
