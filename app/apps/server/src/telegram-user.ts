import { offMode } from "@hub/config/modes";
import type { TelegramUserAccountDto, TelegramUserStatusDto } from "@hub/contract/messengers";
import type { Repos } from "@hub/db";
import {
  AdapterError,
  createTelegramUserAdapter,
  mtcuteClients,
  isParkedCode,
  parkedLine,
  parkedOf,
  pollOnly,
  readSession,
  redactSessions,
  runPoller,
  sessionAccounts,
  sessionsDir,
  type MtClient,
  type MtLoginClient,
  type LoginCredentials,
  type DialogIdentity,
  type ParkedCode,
  type PollEvent,
  type TelegramUserAdapter,
  type TelegramUserSendingAdapter,
  type UserSession,
} from "@hub/messengers";
import { createLoginFlows, removeSession, writeSession, type LoginFlows } from "@hub/messengers/human";
import { messengersProject } from "./messengers";
import { ops } from "@hub/log/ops";

const log = ops("telegram");

/**
 * The supervisor of the Telegram user accounts (P71 M1, decision 0036): one connection per account that has a session under
 * `state/secrets/sessions/telegram_user-<id>/`, each a `runPoller` over a receive-only adapter (`pollOnly`), its state in
 * `/api/health`. A parked account (`logged_out`, `banned`, a flood wait over an hour) is never reconnected by itself, not even
 * after a server restart: the park is read back from `messenger_accounts.last_error`, and only a new login clears it. Nothing
 * here logs a message, a chat or a name; the error lines carry Telegram's code word only, scrubbed of every session value.
 */

const CHANNEL = "telegram_user" as const;

/** The one line that clears each park, for the "needs you" item. */
export const PARK_FIX: Record<ParkedCode, string> = {
  logged_out: "The session ended (logged out or revoked in Telegram): disconnect the account, then connect it again.",
  banned: "Telegram banned this account. It stays parked; disconnect it.",
  flood_wait: "Telegram asked to wait over an hour. It stays parked; after the wait, disconnect the account and connect it again.",
};
const NO_SESSION_FIX = "The session file is missing or unreadable: disconnect the account, then connect it again.";

export const TELEGRAM_USER_OFF: TelegramUserStatusDto = { state: "off", reason: "not started", accounts: [] };

export interface UserClients {
  session: (s: UserSession) => MtClient;
  login: (c: LoginCredentials) => MtLoginClient;
}

export interface StartTelegramUser {
  repos: Repos;
  env?: NodeJS.ProcessEnv;
  /** The sessions folder; default `state/secrets/sessions`. */
  dir?: string;
  /** Default: the real mtcute clients, loaded on first use. Tests pass fakes. */
  clients?: UserClients;
  runner?: typeof runPoller;
  now?: () => Date;
  /** P84: the identity (never the text) of each inbound message of an unlinked private chat, for the autolink. */
  onUnlinked?: (account: string, d: DialogIdentity, inbound: boolean) => void;
  /** P84: an account's first good poll after it connected (the autolink scans its dialogs then). */
  onConnected?: (account: string) => void;
  /** P71 M-P: a poll stored messages in this project (the pre-analysis runs a pass inside the poll, never on a timer). */
  onStored?: (project: string) => void;
}

interface Slot {
  st: TelegramUserAccountDto;
  ac: AbortController;
  adapter: TelegramUserSendingAdapter | null;
  done: Promise<void>;
}

export interface TelegramUserHandle {
  status(): TelegramUserStatusDto;
  /** The project accounts store into, or why there is none. */
  project(): { project: string } | { project: null; reason: string };
  /** The live adapter of a connected account (the picker and the link read through it), else undefined. It has no send. */
  adapter(account: string): TelegramUserAdapter | undefined;
  /** The same account's send, for the server's send door only (P71 M4); undefined while the account is parked, stopped or absent. */
  sender(account: string): TelegramUserSendingAdapter | undefined;
  /** A send that Telegram answered with a park (logged out, banned, a long flood wait) parks the account as a poll would (0036 point 2). */
  sendFailed(account: string, err: AdapterError): Promise<void>;
  /** The login flows; a finished login writes the session and connects the account. */
  login: LoginFlows;
  /** Stops the account's connection and removes its session folder. */
  disconnect(account: string): Promise<boolean>;
  stop(): Promise<void>;
}

export async function startTelegramUser(o: StartTelegramUser): Promise<TelegramUserHandle> {
  const env = o.env ?? process.env;
  const dir = o.dir ?? sessionsDir(env);
  const now = o.now ?? (() => new Date());
  const run = o.runner ?? runPoller;
  const slots = new Map<string, Slot>();
  let clients = o.clients;
  const clientsNow = async (): Promise<UserClients> => (clients ??= await mtcuteClients());

  const off = offMode(env, "messengers") === "off" ? "HUB_MESSENGERS=off" : null;
  const pick = off ? null : await messengersProject(o.repos, env);
  const project = pick?.project ?? null;
  const reason = off ?? pick?.reason ?? "no project";

  const blank = (account: string): TelegramUserAccountDto => ({ account, state: "starting", parked: null, fix: null, failures: 0, stored: 0 });
  const scrub = (text: string) => redactSessions(dir, text).slice(0, 300);

  const allowedChats = async (p: string) => (await o.repos.messengers.allowedChats(p)).filter((c) => c.channel === CHANNEL).map((c) => c.chatId);

  const park = (st: TelegramUserAccountDto, code: ParkedCode) => Object.assign(st, { state: "parked" as const, parked: code, fix: PARK_FIX[code] });

  async function open(account: string, p: string): Promise<void> {
    const st = blank(account);
    const ac = new AbortController();
    const slot: Slot = { st, ac, adapter: null, done: Promise.resolve() };
    slots.set(account, slot);
    const parked = parkedOf((await o.repos.messengers.account(p, CHANNEL, account))?.lastError);
    if (parked) return void park(st, parked);
    const read = readSession(dir, CHANNEL, account);
    if (read.state !== "stored") {
      log.error("the account's session file cannot be read", { account, state: read.state });
      return void Object.assign(st, { state: "error", fix: NO_SESSION_FIX, lastError: `session file: ${read.state}` });
    }
    let told = false;
    const onEvent = (e: PollEvent) => {
      // A park a send reported (P71 M4) holds: the loop's last poll after the abort must not read as running again.
      if (st.parked) return;
      if (e.type === "poll" && !told) {
        told = true;
        o.onConnected?.(account);
      }
      if (e.type === "poll") {
        Object.assign(st, { state: "running", failures: 0, fix: null, lastPollAt: now().toISOString() });
        delete st.lastError;
        st.stored += e.result.stored;
        if (e.result.stored > 0) o.onStored?.(p);
      } else if (e.type === "error") Object.assign(st, { state: "error", failures: e.failures, lastError: scrub(e.error.message) });
    };
    slot.done = (async () => {
      let client: MtClient | null = null;
      try {
        client = (await clientsNow()).session(read.session);
        const adapter = createTelegramUserAdapter({ client, account, allowedChats: () => allowedChats(p), ...(o.onUnlinked ? { onUnlinked: (d: DialogIdentity, inbound: boolean) => o.onUnlinked?.(account, d, inbound) } : {}) });
        slot.adapter = adapter;
        await run({ repos: o.repos, project: p, adapter: pollOnly(adapter), signal: ac.signal, onEvent, now });
        if (st.state !== "error" && st.state !== "parked") st.state = "stopped";
      } catch (e) {
        if (e instanceof AdapterError && e.parked && (e.code === "logged_out" || e.code === "banned" || e.code === "flood_wait")) park(st, e.code);
        else {
          Object.assign(st, { state: "error", lastError: scrub(e instanceof Error ? e.message : String(e)) });
          log.error("the account's receiver stopped", { account, reason: st.lastError });
        }
      } finally {
        slot.adapter = null;
        await client?.close().catch(() => undefined);
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

  const login = createLoginFlows({
    clientFor: (c) => {
      if (!clients) throw new Error("the Telegram client is not loaded");
      return clients.login(c);
    },
    store: async (account, s) => {
      if (!project) throw new Error(reason);
      writeSession(dir, CHANNEL, account, s);
      // A new login clears a park: the cursor stays, the error goes.
      const row = await o.repos.messengers.account(project, CHANNEL, account);
      if (parkedOf(row?.lastError)) await o.repos.messengers.markPollOk(project, CHANNEL, account, row?.cursor ?? null, now().toISOString());
      await close(account);
      await open(account, project);
    },
  });
  const start = login.start;
  const live = (account: string): TelegramUserAdapter | undefined => {
    const s = slots.get(account);
    return s && s.st.state !== "parked" && s.st.state !== "stopped" ? (s.adapter ?? undefined) : undefined;
  };

  return {
    status: () =>
      project ? { state: "on", project, accounts: [...slots.values()].map((s) => ({ ...s.st })) } : { state: "off", reason, accounts: [] },
    project: () => (project ? { project } : { project: null, reason }),
    adapter: (account) => live(account),
    // The same live adapter, typed with its send: only `app.ts` hands it on, to the send door.
    sender: (account) => (live(account) ? (slots.get(account)?.adapter ?? undefined) : undefined),
    async sendFailed(account, err) {
      const s = slots.get(account);
      if (!project || !s || !isParkedCode(err.code)) return;
      log.error("a send parked the account", { account, kind: err.code, reason: scrub(err.message) });
      park(s.st, err.code);
      await o.repos.messengers.markPollError(project, CHANNEL, account, parkedLine(err.code, scrub(err.message)), now().toISOString());
      s.ac.abort();
    },
    login: {
      ...login,
      // The real client is loaded before the first login; the flows themselves stay synchronous over it.
      start: async (input) => {
        await clientsNow();
        return start(input);
      },
    },
    async disconnect(account) {
      await close(account);
      return removeSession(dir, CHANNEL, account);
    },
    async stop() {
      await login.closeAll();
      for (const a of [...slots.keys()]) await close(a);
    },
  };
}
