import { offMode } from "@hub/config/modes";
import type { TelegramUserAccountDto, WaAppHistoryDto, WhatsAppStatusDto } from "@hub/contract/messengers";
import type { Repos } from "@hub/db";
import {
  AdapterError,
  baileysSocketFactory,
  createWhatsAppAdapter,
  ingest,
  isParkedCode,
  parkedLine,
  parkedOf,
  pollOnly,
  readWaAuth,
  RETENTION_DAYS,
  runPoller,
  sessionAccounts,
  sessionsDir,
  waFolderOf,
  type DialogIdentity,
  type ParkedCode,
  type PollEvent,
  type StoredChat,
  WA_CACHE_DAYS,
  type WaAddress,
  type WaAppReader,
  type WaSocketFactory,
  type WhatsAppAdapter,
  type WhatsAppSendingAdapter,
} from "@hub/messengers";
import { createWaPairing, removeSession, type WaPairing } from "@hub/messengers/human";
import { messengersProject } from "../bot";
import { errFields, ops } from "@hub/log/ops";

const log = ops("whatsapp");

/**
 * The supervisor of the WhatsApp linked devices (P71 M5, decision 0036): one socket per number that has a folder under
 * `state/secrets/sessions/whatsapp-<number>/`, each a `runPoller` over a receive-only adapter (`pollOnly`), its state in
 * `/api/health`. A parked number (logged out on the phone, banned) is never reconnected by itself, not even after a server
 * restart: the park is read back from `messenger_accounts.last_error`, and only a new QR scan clears it. Nothing here logs a
 * message, a chat or a name; the error lines carry WhatsApp's close code only. The QR code lives in the pairing flow until the
 * admin reads it, and nowhere else.
 */

const CHANNEL = "whatsapp" as const;

/** The one line that clears each park, for the "needs you" item. WhatsApp has no flood wait; the entry is there for the type. */
export const WA_PARK_FIX: Record<ParkedCode, string> = {
  logged_out: "WhatsApp ended the link (logged out, or removed under Linked devices on the phone): disconnect, then connect again with a new QR code.",
  banned: "WhatsApp banned or restricted this number. It stays parked; disconnect it.",
  flood_wait: "WhatsApp asked to wait. It stays parked; disconnect, then connect again later.",
};
const NO_SESSION_FIX = "The session folder is missing, unreadable or readable by others: disconnect, then connect again with a new QR code.";

export const WHATSAPP_OFF: WhatsAppStatusDto = { state: "off", reason: "not started", accounts: [] };

export interface StartWhatsApp {
  repos: Repos;
  env?: NodeJS.ProcessEnv;
  /** The sessions folder; default `state/secrets/sessions`. */
  dir?: string;
  /** Default: the real Baileys socket, loaded on first use. Tests pass `FakeWaSocket`. */
  sockets?: WaSocketFactory;
  runner?: typeof runPoller;
  now?: () => Date;
  /** Tests: how long a history request stays open before its "no answer" line (default 120 s). */
  historyMs?: number;
  /**
   * P141 W3 (decision 0049 points 3 and 4): the Mac's WhatsApp app as the read-only refill of a chat, opened once when a project is
   * on. Only the server's composition passes the real one, so no test opens the owner's own WhatsApp database. Absent: no refill,
   * and the cache keeps 90 days.
   */
  appReader?: () => WaAppReader;
  /** Decision 0049 point 6: whether the owner hid the chat ("not a client"); nothing of a hidden chat is cached. Absent: none is hidden. */
  hidden?: (chatId: string) => Promise<boolean>;
  /** P84: the identity (never the text) of each private chat seen that is not linked, for the autolink. */
  onUnlinked?: (account: string, d: DialogIdentity, inbound: boolean) => void;
  /** P71 M-P: a poll stored messages in this project, in these chats (the pre-analysis and, P139, the autopilot wake inside the poll, never on a timer). */
  onStored?: (project: string, chats: StoredChat[]) => void;
}

interface Slot {
  st: TelegramUserAccountDto;
  ac: AbortController;
  adapter: WhatsAppSendingAdapter | null;
  done: Promise<void>;
}

export interface WhatsAppHandle {
  status(): WhatsAppStatusDto;
  /** P141 W3: the Mac app's refill as the server's own process found it, and the cache's TTL that follows from it. */
  appHistory(): WaAppHistoryDto;
  /**
   * P141 W3 (decision 0049 point 3): opening a chat refills its cache from the Mac's WhatsApp app (read only, local, no socket),
   * through the one ingest. Returns how many rows it stored; 0 when the app is off or holds nothing new. A chat is read from the app at
   * most once per `REFILL_EVERY_MS` (every conversation read calls it, and the admin re-reads on each live change); `force`, the
   * conversation's Refresh, reads it now.
   */
  refill(project: string, chat: WaAddress, opts?: { force?: boolean }): Promise<number>;
  project(): { project: string } | { project: null; reason: string };
  /** The live adapter of a connected number (the picker and the link read through it), else undefined. It has no send. */
  adapter(account: string): WhatsAppAdapter | undefined;
  /** The same number's send, for the server's send door only; undefined while it is parked, stopped or absent. */
  sender(account: string): WhatsAppSendingAdapter | undefined;
  /** A send WhatsApp answered with a park (logged out, banned) parks the number as a poll would (0036 point 2). */
  sendFailed(account: string, err: AdapterError): Promise<void>;
  /** The pairing by QR code; a scanned pairing writes the folder and connects the number. */
  pairing: WaPairing;
  /** Stops the number's socket, unlinks the device on WhatsApp's side (best effort) and removes its folder. */
  disconnect(account: string): Promise<boolean>;
  stop(): Promise<void>;
}

/** P141 W3 fix (2026-11-24): a chat is read from the Mac's app at most once a minute, unless the conversation's Refresh asks. */
export const REFILL_EVERY_MS = 60_000;

/**
 * P141 W3: the Mac's WhatsApp app, probed once at start. While it is readable the cache keeps 30 days (it refills a chat); else 90
 * (decision 0049 point 4), and one ops line says why. A read that fails is a line, never a stop (the app may be mid-write).
 */
function appSource(reader: WaAppReader | null) {
  const app = reader?.state() ?? { state: "off" as const, reason: "missing" as const, detail: "The Mac's WhatsApp app is not read by this server.", fix: null };
  const cacheDays = app.state === "on" ? WA_CACHE_DAYS : RETENTION_DAYS;
  if (reader && app.state === "on") log.info("the Mac's WhatsApp app refills chats (read only)", { cacheDays });
  else if (reader && app.state === "off") log.warn("the Mac's WhatsApp app cannot refill chats", { reason: app.reason, detail: app.detail, ...(app.fix ? { fix: app.fix } : {}) });
  const appHistory = (): WaAppHistoryDto => (app.state === "on" ? { state: "on", reason: null, detail: null, fix: null, cacheDays } : { state: "off", reason: app.reason, detail: app.detail, fix: app.fix, cacheDays });
  const fromApp = (chat: WaAddress, since: Date, account: string) => {
    try {
      return reader?.read(chat, since, account) ?? [];
    } catch (e) {
      log.warn("reading a chat from the Mac's WhatsApp app failed", errFields(e));
      return [];
    }
  };
  return { reader: app.state === "on" ? reader : null, cacheDays, appHistory, fromApp };
}

export async function startWhatsApp(o: StartWhatsApp): Promise<WhatsAppHandle> {
  const env = o.env ?? process.env;
  const dir = o.dir ?? sessionsDir(env);
  const now = o.now ?? (() => new Date());
  /** When each chat was last read from the Mac's app (memory only): the refill's throttle. */
  const refilledAt = new Map<string, number>();
  const run = o.runner ?? runPoller;
  const slots = new Map<string, Slot>();
  let sockets = o.sockets;
  const socketsNow = async (): Promise<WaSocketFactory> => (sockets ??= await baileysSocketFactory());

  const off = offMode(env, "messengers") === "off" ? "HUB_MESSENGERS=off" : null;
  const pick = off ? null : await messengersProject(o.repos, env);
  const project = pick?.project ?? null;
  const reason = off ?? pick?.reason ?? "no project";

  const blank = (account: string): TelegramUserAccountDto => ({ account, state: "starting", parked: null, fix: null, failures: 0, stored: 0 });
  const allowedChats = async (p: string) => (await o.repos.messengers.allowedChats(p)).filter((c) => c.channel === CHANNEL).map((c) => ({ chatId: c.chatId, jid: c.jid }));

  const { reader, cacheDays, appHistory, fromApp } = appSource(project && o.appReader ? o.appReader() : null);
  const isHidden = o.hidden ?? (async () => false);
  const park = (st: TelegramUserAccountDto, code: ParkedCode) => Object.assign(st, { state: "parked" as const, parked: code, fix: WA_PARK_FIX[code] });

  async function open(account: string, p: string): Promise<void> {
    const st = blank(account);
    const ac = new AbortController();
    const slot: Slot = { st, ac, adapter: null, done: Promise.resolve() };
    slots.set(account, slot);
    const parked = parkedOf((await o.repos.messengers.account(p, CHANNEL, account))?.lastError);
    if (parked) return void park(st, parked);
    const read = readWaAuth(dir, account);
    if (read.state !== "stored") {
      log.error("the number's session folder cannot be read", { account, state: read.state });
      return void Object.assign(st, { state: "error", fix: NO_SESSION_FIX, lastError: `session folder: ${read.state}` });
    }
    const onEvent = (e: PollEvent) => {
      if (st.parked) return;
      if (e.type === "poll") {
        Object.assign(st, { state: "running", failures: 0, fix: null, lastPollAt: now().toISOString() });
        delete st.lastError;
        st.stored += e.result.stored;
        if (e.result.stored > 0) o.onStored?.(p, e.result.chats);
      } else if (e.type === "error") Object.assign(st, { state: "error", failures: e.failures, lastError: e.error.message.slice(0, 300) });
    };
    slot.done = (async () => {
      let adapter: WhatsAppSendingAdapter | null = null;
      try {
        const make = await socketsNow();
        adapter = createWhatsAppAdapter({
          socket: () => make(read.auth),
          account,
          allowedChats: () => allowedChats(p),
          // Decision 0049 (P141 W2): every private chat that writes is cached, unless the owner hid it.
          cacheUnlinked: true,
          cacheDays,
          ...(reader ? { appHistory: (chat: WaAddress, since: Date) => fromApp(chat, since, account) } : {}),
          ...(o.onUnlinked ? { onUnlinked: (d: DialogIdentity, inbound: boolean) => o.onUnlinked?.(account, d, inbound) } : {}),
          ...(o.historyMs ? { historyMs: o.historyMs } : {}),
        });
        slot.adapter = adapter;
        await run({ repos: o.repos, project: p, adapter: pollOnly(adapter), signal: ac.signal, onEvent, now, retentionDays: cacheDays, cache: { channel: CHANNEL, hidden: isHidden } });
        if (st.state !== "error" && st.state !== "parked") st.state = "stopped";
      } catch (e) {
        if (e instanceof AdapterError && e.parked && isParkedCode(e.code)) park(st, e.code);
        else {
          Object.assign(st, { state: "error", lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
          log.error("the number's receiver stopped", { account, reason: st.lastError });
        }
      } finally {
        slot.adapter = null;
        await adapter?.close().catch(() => undefined);
      }
    })();
  }

  async function close(account: string): Promise<void> {
    const s = slots.get(account);
    if (!s) return;
    s.ac.abort();
    await Promise.race([s.done, new Promise((r) => setTimeout(r, 2000))]);
    slots.delete(account);
  }

  if (project) for (const a of sessionAccounts(dir, CHANNEL)) await open(a, project);

  const pairing = createWaPairing({
    socketFor: (auth) => {
      if (!sockets) throw new Error("the WhatsApp client is not loaded");
      return sockets(auth);
    },
    store: async (me, auth) => {
      if (!project) throw new Error(reason);
      await close(me.account);
      removeSession(dir, CHANNEL, me.account);
      auth.persistTo(waFolderOf(dir, me.account));
      // A new scan clears a park: the cursor stays, the error goes.
      const row = await o.repos.messengers.account(project, CHANNEL, me.account);
      if (parkedOf(row?.lastError)) await o.repos.messengers.markPollOk(project, CHANNEL, me.account, row?.cursor ?? null, now().toISOString());
      await open(me.account, project);
    },
  });
  const startPairing = pairing.start;
  const live = (account: string): WhatsAppSendingAdapter | undefined => {
    const s = slots.get(account);
    return s && s.st.state !== "parked" && s.st.state !== "stopped" ? (s.adapter ?? undefined) : undefined;
  };

  return {
    status: () => (project ? { state: "on", project, accounts: [...slots.values()].map((s) => ({ ...s.st })), appHistory: appHistory() } : { state: "off", reason, accounts: [] }),
    appHistory,
    async refill(p, chat, opts) {
      if (!reader || p !== project) return 0;
      const key = `${p}|${chat.chatId}`;
      const last = refilledAt.get(key);
      if (!opts?.force && last !== undefined && now().getTime() - last < REFILL_EVERY_MS) return 0;
      refilledAt.set(key, now().getTime());
      // The chat is read by its account: the one stored on its row, else the only connected number.
      const row = await o.repos.messengers.chat(p, CHANNEL, chat.chatId);
      const account = row?.account ?? (slots.size === 1 ? [...slots.keys()][0] : undefined);
      if (!account) return 0;
      const at = now();
      const rows = fromApp({ chatId: chat.chatId, jid: chat.jid ?? row?.jid ?? null }, new Date(at.getTime() - cacheDays * 86_400_000), account);
      if (!rows.length) return 0;
      // History, not a new message: it wakes neither the pre-analysis nor the autopilot.
      const r = await ingest({ project: p, repos: o.repos, now: () => at, retentionDays: cacheDays, cache: { channel: CHANNEL, hidden: isHidden } }, rows);
      return r.stored;
    },
    project: () => (project ? { project } : { project: null, reason }),
    adapter: (account) => live(account),
    sender: (account) => live(account),
    async sendFailed(account, err) {
      const s = slots.get(account);
      if (!project || !s || !isParkedCode(err.code)) return;
      log.error("a send parked the number", { account, kind: err.code, reason: err.message.slice(0, 300) });
      park(s.st, err.code);
      await o.repos.messengers.markPollError(project, CHANNEL, account, parkedLine(err.code, err.message.slice(0, 300)), now().toISOString());
      s.ac.abort();
    },
    pairing: {
      ...pairing,
      // The real socket is loaded on the owner's Connect, not before.
      start: async () => {
        if (!project) throw new Error(reason);
        await socketsNow();
        return startPairing();
      },
    },
    async disconnect(account) {
      // A connected number is unlinked on WhatsApp's side too, so the device leaves the phone's Linked devices list; a failure (or
      // a parked number, already unlinked) still removes the folder.
      const adapter = live(account);
      if (adapter) await Promise.race([adapter.logout(), new Promise((r) => setTimeout(r, 5000))]).catch((e: unknown) => log.warn("logout on disconnect failed; the folder is removed anyway", { account, ...errFields(e) }));
      await close(account);
      return removeSession(dir, CHANNEL, account);
    },
    async stop() {
      await pairing.closeAll();
      for (const a of [...slots.keys()]) await close(a);
    },
  };
}
