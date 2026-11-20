import { randomBytes } from "node:crypto";
import qrcode from "qrcode-generator";
import { MessengersError } from "./errors";
import { WaAuthFiles } from "./whatsapp-auth";
import { WA_CODES, type WaMe, type WaSocket, type WaSocketFactory } from "./whatsapp";

/**
 * Linking WhatsApp as a device (P71 M5, decision 0036 point 4): the owner presses Connect, the server opens a socket over an empty
 * in-memory auth store, Baileys shows a QR code (a new one about every 20 s), the owner scans it with his phone (WhatsApp ▸ Linked
 * devices ▸ Link a device). When the phone has scanned, the store holds the account's creds: it is written to the account's folder
 * (0700, files 0600) by the caller's `store`, the pairing socket is closed, and the supervisor connects the account from its files.
 * Nothing of the pairing is written before the scan; the QR code is never logged or written, it lives in this flow until read.
 */

export type PairingStep =
  | { step: "waiting" }
  | { step: "qr"; size: number; rows: string[] }
  | { step: "done"; account: string; name: string }
  | { step: "failed"; reason: string };

export interface PairingDeps {
  socketFor: WaSocketFactory;
  /** Writes the store to the account's folder and connects the account (the caller is the supervisor). */
  store: (me: WaMe, auth: WaAuthFiles) => Promise<void>;
  now?: () => number;
  ttlMs?: number;
}

/** A pairing lives 3 minutes: WhatsApp stops refreshing the code after about five codes anyway. */
export const PAIRING_TTL_MS = 3 * 60_000;

/** The QR code as rows of `1` (dark) and `0`, for the admin to draw: no image library there, no QR string in a reply. */
export function qrRows(text: string): { size: number; rows: string[] } {
  const qr = qrcode(0, "L");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const rows: string[] = [];
  for (let r = 0; r < size; r++) {
    let row = "";
    for (let c = 0; c < size; c++) row += qr.isDark(r, c) ? "1" : "0";
    rows.push(row);
  }
  return { size, rows };
}

interface Flow {
  sock: WaSocket;
  auth: WaAuthFiles;
  state: PairingStep;
  until: number;
}

const FAILED: Record<number, string> = {
  [WA_CODES.timedOut]: "The QR code expired before it was scanned: press Connect again.",
  [WA_CODES.loggedOut]: "WhatsApp refused to link this device: press Connect again.",
  [WA_CODES.forbidden]: "WhatsApp refused this number (banned or restricted).",
  [WA_CODES.connectionReplaced]: "Another device took over the link: press Connect again.",
};

export function createWaPairing(deps: PairingDeps) {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? PAIRING_TTL_MS;
  const flows = new Map<string, Flow>();

  const drop = async (id: string) => {
    const f = flows.get(id);
    flows.delete(id);
    await f?.sock.close().catch(() => undefined);
  };
  const sweep = async () => {
    for (const [id, f] of flows) if (f.until <= now()) await drop(id);
  };

  return {
    /** Starts the one pairing (a new Connect cancels an older one): the socket opens and the first QR code follows. */
    async start(): Promise<{ flow: string }> {
      await sweep();
      for (const id of [...flows.keys()]) await drop(id);
      const auth = new WaAuthFiles(null);
      const sock = deps.socketFor(auth);
      const id = randomBytes(18).toString("base64url");
      const f: Flow = { sock, auth, state: { step: "waiting" }, until: now() + ttl };
      flows.set(id, f);
      sock.listen({
        connection(u) {
          if (f.state.step === "done" || f.state.step === "failed") return;
          if (u.state === "qr") {
            f.state = { step: "qr", ...qrRows(u.qr) };
          } else if (u.state === "paired") {
            const me = u.me;
            f.state = { step: "waiting" };
            void (async () => {
              try {
                await f.sock.close().catch(() => undefined);
                await deps.store(me, f.auth);
                f.state = { step: "done", account: me.account, name: me.name };
              } catch (e) {
                f.state = { step: "failed", reason: e instanceof Error ? `The link was made but could not be saved: ${e.message}` : "The link could not be saved." };
              }
            })();
          } else if (u.state === "close" && u.code !== WA_CODES.restartRequired) {
            f.state = { step: "failed", reason: FAILED[u.code ?? 0] ?? `WhatsApp closed the connection${u.code ? ` (code ${u.code})` : ""}: press Connect again.` };
            void f.sock.close().catch(() => undefined);
          }
        },
        messages: () => undefined,
        chats: () => undefined,
      });
      return { flow: id };
    },

    /** Where the pairing stands. A finished or failed flow is dropped once read. */
    async state(id: string): Promise<PairingStep> {
      await sweep();
      const f = flows.get(id);
      if (!f) throw new MessengersError("bad_login", "This connect has expired or was never started: press Connect again.");
      if (f.state.step === "done" || f.state.step === "failed") flows.delete(id);
      return f.state;
    },

    cancel: drop,
    async closeAll() {
      for (const id of [...flows.keys()]) await drop(id);
    },
    size: () => flows.size,
  };
}
export type WaPairing = ReturnType<typeof createWaPairing>;
