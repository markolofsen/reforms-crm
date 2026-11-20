import { randomBytes } from "node:crypto";
import { MessengersError } from "./errors";
import { toUserAdapterError, type MtMe } from "./telegram-user";

/**
 * The login of a Telegram user account (decision 0036 point 4): `api_id` and `api_hash` from my.telegram.org, the phone, the code
 * Telegram sends, then the 2FA password when the account has one. The owner types each into the admin; each step is one server
 * call. The values live only in this process's memory for the flow (10 minutes at most) and are never written, logged or returned;
 * what is persisted, by the caller's `store`, is the final session alone. The agent never types a code or a password.
 */

/** The part of an unauthorised mtcute client the login uses (`telegram-user-api.ts` maps mtcute onto it; tests pass a fake). */
export interface MtLoginClient {
  /** Asks Telegram to send the code. */
  sendCode(phone: string): Promise<{ phoneCodeHash: string }>;
  /** Throws an RpcError-shaped `SESSION_PASSWORD_NEEDED` when the account has a 2FA password. */
  signIn(o: { phone: string; phoneCodeHash: string; code: string }): Promise<MtMe>;
  checkPassword(password: string): Promise<MtMe>;
  exportSession(): Promise<string>;
  close(): Promise<void>;
}

export interface LoginCredentials {
  apiId: number;
  apiHash: string;
}

export type LoginStep = { step: "code"; flow: string } | { step: "password"; flow: string } | { step: "done"; account: string; name: string };

export interface LoginDeps {
  clientFor: (c: LoginCredentials) => MtLoginClient;
  /** Persists the final session (the caller writes the file at mode 0600 and starts the connection). */
  store: (account: string, s: LoginCredentials & { session: string }) => Promise<void>;
  now?: () => number;
  ttlMs?: number;
}

interface Flow {
  creds: LoginCredentials;
  phone: string;
  phoneCodeHash: string;
  client: MtLoginClient;
  step: "code" | "password";
  until: number;
  /** What the owner typed, so an error text is scrubbed of it before it leaves this module. */
  typed: string[];
}

/** A flow lives 10 minutes: Telegram's code expires about then too. */
export const LOGIN_TTL_MS = 10 * 60_000;
const MAX_FLOWS = 4;

/** Telegram's refusals during a login, as the sentence the admin shows. Never the value that was typed. */
const SAY: Record<string, string> = {
  API_ID_INVALID: "Telegram does not know this api_id and api_hash: copy both again from my.telegram.org.",
  API_ID_PUBLISHED_FLOOD: "This api_id was published and is blocked: create your own app on my.telegram.org.",
  PHONE_NUMBER_INVALID: "Telegram does not know this phone number: type it in international format, with + and the country code.",
  PHONE_NUMBER_BANNED: "Telegram has banned this phone number.",
  PHONE_CODE_INVALID: "The code is wrong: type the code Telegram sent again.",
  PHONE_CODE_EMPTY: "Type the code Telegram sent.",
  PHONE_CODE_EXPIRED: "The code has expired: start again to get a new one.",
  PASSWORD_HASH_INVALID: "The password is wrong: type your Telegram two-step verification password again.",
  PHONE_NUMBER_UNOCCUPIED: "No Telegram account uses this phone number: sign up in the Telegram app first.",
};

const scrub = (text: string, typed: readonly string[]) => typed.filter((t) => t.length >= 3).reduce((s, t) => s.split(t).join("***"), text);

/** A login refusal (`bad_login`) with a sentence for the owner, scrubbed of everything he typed. */
function refusal(err: unknown, typed: readonly string[]): MessengersError {
  const text = typeof err === "object" && err !== null ? Reflect.get(err, "text") : undefined;
  if (typeof text === "string" && SAY[text]) return new MessengersError("bad_login", SAY[text]);
  const a = toUserAdapterError(err);
  if (a.code === "flood_wait" || a.code === "rate_limited") return new MessengersError("bad_login", `Telegram asks to wait ${Math.ceil((a.retryAfterMs ?? 60_000) / 60_000)} min before the next try.`);
  if (a.code === "banned") return new MessengersError("bad_login", "Telegram has banned this account.");
  if (a.code === "network") return new MessengersError("bad_login", "Telegram could not be reached: check the network and start again.");
  return new MessengersError("bad_login", scrub(`Telegram refused the login (${a.message}).`, typed));
}

const needsPassword = (err: unknown) => typeof err === "object" && err !== null && Reflect.get(err, "text") === "SESSION_PASSWORD_NEEDED";

export function createLoginFlows(deps: LoginDeps) {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? LOGIN_TTL_MS;
  const flows = new Map<string, Flow>();

  const drop = async (id: string) => {
    const f = flows.get(id);
    flows.delete(id);
    await f?.client.close().catch(() => undefined);
  };
  const sweep = async () => {
    for (const [id, f] of flows) if (f.until <= now()) await drop(id);
  };
  const take = async (id: string, step: Flow["step"]): Promise<Flow> => {
    await sweep();
    const f = flows.get(id);
    if (!f) throw new MessengersError("bad_login", "This login has expired or was never started: start again.");
    if (f.step !== step) throw new MessengersError("bad_login", step === "code" ? "This login waits for the password, not the code." : "This login waits for the code, not the password.");
    return f;
  };
  const finish = async (id: string, f: Flow, me: MtMe): Promise<LoginStep> => {
    const session = await f.client.exportSession();
    await deps.store(String(me.id), { ...f.creds, session });
    await drop(id);
    return { step: "done", account: String(me.id), name: me.displayName };
  };

  return {
    async start(input: { apiId: number; apiHash: string; phone: string }): Promise<LoginStep> {
      await sweep();
      while (flows.size >= MAX_FLOWS) await drop(flows.keys().next().value ?? "");
      const creds = { apiId: input.apiId, apiHash: input.apiHash.trim() };
      const phone = input.phone.replace(/[\s\-().]/g, "");
      const typed = [creds.apiHash, phone, String(creds.apiId)];
      const client = deps.clientFor(creds);
      try {
        const { phoneCodeHash } = await client.sendCode(phone);
        const flow = randomBytes(18).toString("base64url");
        flows.set(flow, { creds, phone, phoneCodeHash, client, step: "code", until: now() + ttl, typed });
        return { step: "code", flow };
      } catch (err) {
        await client.close().catch(() => undefined);
        throw refusal(err, typed);
      }
    },

    async code(flow: string, code: string): Promise<LoginStep> {
      const f = await take(flow, "code");
      const c = code.replace(/\s/g, "");
      try {
        return await finish(flow, f, await f.client.signIn({ phone: f.phone, phoneCodeHash: f.phoneCodeHash, code: c }));
      } catch (err) {
        if (needsPassword(err)) {
          f.step = "password";
          return { step: "password", flow };
        }
        throw refusal(err, [...f.typed, c]);
      }
    },

    async password(flow: string, password: string): Promise<LoginStep> {
      const f = await take(flow, "password");
      try {
        return await finish(flow, f, await f.client.checkPassword(password));
      } catch (err) {
        throw refusal(err, [...f.typed, password]);
      }
    },

    cancel: drop,
    /** Tests and shutdown. */
    async closeAll() {
      for (const id of [...flows.keys()]) await drop(id);
    },
    size: () => flows.size,
  };
}
export type LoginFlows = ReturnType<typeof createLoginFlows>;
