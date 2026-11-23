import { basename } from "node:path";
import { hubPaths } from "@hub/config/paths";
import { inspect, isTelegramToken, notionShapeProblem, parseConnectionId, redact, removeSecret, storeToken, testConnection, type ConnectionRow, type ProbeDeps, type ProjectUse, type Verdict } from "@hub/connections";
import { CONNECTION_FRESH_MINUTES, type CheckErrorCode, type CheckValueDto, type ConnectionDto, type ConnectionsDto, type MailAccountDto, type MailReadDto } from "@hub/contract/connections";
import type { SetSecretBody } from "@hub/contract/requests";
import type { Repos } from "@hub/db";
import { MAIL_NOT_ANSWERING_FIX, MailNotAnswering, osaWithin, type OsaRun } from "@hub/send";
import { readAccounts } from "./apple-mail";
import { configOf } from "./overview-facts";
import type { MessengersStatus } from "./messengers";

/**
 * The service of Settings ▸ Connections and ▸ Mail: the Notion token and the Telegram bot (files and settings, no network on a list), and the
 * projects' mail accounts read-only (decision 0026: one bounded, cached question to Apple Mail, never launched for it). A test
 * is one probe of one token, kept in server memory with its time: two tests closer than MIN_TEST_SECONDS share the earlier
 * result, and one in flight is shared. A cached result belongs to the secret it tested: when the file's change time moves,
 * the result is dropped. No value is ever returned.
 */
export interface ConnectionsService {
  /**
   * `mailWithinMs` (P63, the Overview's parts): wait at most this long for Mail's answer about its accounts; past it the rows say
   * `foundInMail: null` with `not-answering`, and the read goes on in the background to fill the cache for the next call.
   */
  list(o?: { mailWithinMs?: number }): Promise<ConnectionsDto>;
  /** `undefined`: no such connection. Throws `NotTestable` when the row offers no Test. */
  test(id: string): Promise<ConnectionDto | undefined>;
  /** Stores a key and returns the row as it now stands. `undefined`: no such connection. Throws `Refusal`. The value leaves this call only into the file. */
  setSecret(id: string, body: SetSecretBody): Promise<ConnectionDto | undefined>;
  /** Deletes the key file. `undefined`: no such connection. Throws `Refusal`. */
  removeSecret(id: string): Promise<ConnectionDto | undefined>;
}

/** A write the panel will not do, with a sentence that never holds a value: 400 for a key that cannot be one, 409 for a row that cannot take the action. */
export class Refusal extends Error {
  readonly status: 400 | 409;
  constructor(message: string, status: 400 | 409) {
    super(message);
    this.name = "Refusal";
    this.status = status;
  }
}

export class NotTestable extends Error {
  constructor(what: string) {
    super(`${what} has nothing to test: store a token first, or fix the file.`);
    this.name = "NotTestable";
  }
}

export interface ConnectionsOptions {
  repos: Repos;
  /** Secrets folder. Default: this instance's `hubPaths().secrets`, read per call. */
  dir?: () => string;
  env?: NodeJS.ProcessEnv;
  deps?: ProbeDeps;
  messengers?: () => MessengersStatus;
  now?: () => Date;
  minIntervalMs?: number;
  /** Project settings, mapped to what a connection cares about. Default: the registry. */
  projects?: () => Promise<ProjectUse[]>;
  /** What Apple Mail answered about its accounts. Default: not running, so no test reaches Mail; `main.ts` passes `appleMailAccounts()`. */
  mailAccounts?: () => Promise<MailAccountsRead>;
}

/** Two tests of one connection closer than this share the earlier result. Seconds. */
export const MIN_TEST_SECONDS = 30;
/** How long one answer of Apple Mail about its accounts is kept (a "not answering" too: a hung Mail costs one wait a minute). */
export const MAIL_ACCOUNTS_TTL_MS = 60_000;
/**
 * The budget of one read of Mail's accounts. Measured 2026-11-19: a Mail that holds AppleEvents kept `GET /api/connections`
 * open past 60 s (osascript's own limit was 2 min), so the whole Connections page, its autostart switch included, stayed
 * skeletons. A healthy Mail answers in well under a second.
 */
export const MAIL_ACCOUNTS_TIMEOUT_MS = 5_000;

/** What one read of Mail's accounts found. `not-running`: Mail is closed (never started for this). */
export type MailAccountsRead = { state: "answered"; accounts: string[] } | { state: "not-running" } | { state: "not-answering" };

/** The rows' `mailRead`: the state, and the fix line when Mail runs but does not answer. */
export const mailReadOf = (r: MailAccountsRead): MailReadDto => ({ state: r.state, fix: r.state === "not-answering" ? MAIL_NOT_ANSWERING_FIX : null });

/**
 * One `osascript` read of Mail's accounts with its own budget, at most once per `ttlMs`, shared while in flight. A cut read
 * is `not-answering`; any other failure is `not-running` (it could not be asked), never a guess.
 */
export function appleMailAccounts(o: { osa?: OsaRun; now?: () => Date; ttlMs?: number; timeoutMs?: number } = {}): () => Promise<MailAccountsRead> {
  const osa = o.osa ?? osaWithin(o.timeoutMs ?? MAIL_ACCOUNTS_TIMEOUT_MS);
  const now = o.now ?? (() => new Date());
  let kept: { at: number; value: MailAccountsRead } | undefined;
  let inflight: Promise<MailAccountsRead> | undefined;
  return async () => {
    if (kept && now().getTime() - kept.at < (o.ttlMs ?? MAIL_ACCOUNTS_TTL_MS)) return kept.value;
    inflight ??= readAccounts(osa)
      .then((accounts): MailAccountsRead => (accounts === null ? { state: "not-running" } : { state: "answered", accounts }))
      .catch((e: unknown): MailAccountsRead => (e instanceof MailNotAnswering ? { state: "not-answering" } : { state: "not-running" }))
      .then((value) => ((kept = { at: now().getTime(), value }), value))
      .finally(() => (inflight = undefined));
    return inflight;
  };
}

interface Cached { verdict: Verdict; at: Date; changedAt: string | undefined }

/**
 * Stub providers: every call succeeds, except for a secret that contains REJECT, which is refused like a wrong key. The real probe code still runs
 * on top of them, so the e2e run exercises the same paths without any network.
 */
export function fakeProbeDeps(): ProbeDeps {
  const fetchFake = (async (url: string, init?: { headers?: Record<string, string> }) => {
    const sent = `${String(url)} ${init?.headers?.authorization ?? ""}`;
    if (sent.includes("REJECT")) return new Response("{}", { status: 401 });
    const body = String(url).includes("telegram") ? { result: { username: "fakebot" } } : { name: "Fake Notion bot" };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fetchFake };
}

/** With HUB_CONNECTIONS_PROBE=fake: Mail "has" every account a project lists, so no e2e run asks the real Mail. */
export const fakeMailAccounts = (accounts: () => Promise<string[]>) => async (): Promise<MailAccountsRead> => ({ state: "answered", accounts: (await accounts()).map((a) => a.toLowerCase()) });

const FIX: Record<ConnectionRow["kind"], string> = {
  notion: "Replace the token in this row with a working integration token.",
  telegram: "Replace the bot token in this row with the token of a bot made in BotFather.",
};

function errorCode(v: Verdict): CheckErrorCode {
  if (v.state === "unverified") return /timeout/i.test(v.detail) ? "timeout" : "unreachable";
  return /no secret|empty/.test(v.detail) ? "token-missing" : "token-rejected";
}

const toDto = (row: ConnectionRow, cached: Cached | undefined, now: Date): ConnectionDto => {
  const fresh = cached && cached.changedAt === row.secret.changedAt ? cached : undefined;
  const base = { ...row, identity: row.identity ?? (fresh?.verdict.state === "valid" ? (fresh.verdict.identity ?? null) : null) };
  if (!fresh) return { ...base, check: { state: "never" } };
  const asOf = fresh.at.toISOString();
  const { verdict } = fresh;
  if (verdict.state === "valid") {
    const value: CheckValueDto = { detail: verdict.detail, identity: verdict.identity ?? null };
    return { ...base, check: { state: now.getTime() - fresh.at.getTime() > CONNECTION_FRESH_MINUTES * 60_000 ? "stale" : "fresh", asOf, value } };
  }
  return { ...base, check: { state: "error", code: errorCode(verdict), message: verdict.detail, fix: verdict.state === "unverified" ? "Check the network, then Test again." : FIX[row.kind], asOf } };
};

export function createConnections(o: ConnectionsOptions): ConnectionsService {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  const minMs = o.minIntervalMs ?? MIN_TEST_SECONDS * 1000;
  const dir = o.dir ?? (() => hubPaths().secrets);
  const deps: ProbeDeps = o.deps ?? { fetch };
  const cache = new Map<string, Cached>();
  const inflight = new Map<string, Promise<void>>();

  const registry = async () => (await o.repos.projects.registry()).projects.map((p) => ({ slug: p.slug, config: configOf(p) }));
  const projects = o.projects ?? (async (): Promise<ProjectUse[]> => (await registry()).map((p) => ({ slug: p.slug, notionTokenFile: p.config.notion.tokenFile })));
  const known = o.mailAccounts ?? (async (): Promise<MailAccountsRead> => ({ state: "not-running" }));

  /** Every account a registered project lists, once, with the projects that list it; `foundInMail` from one bounded read of Mail. */
  const mailRows = async (withinMs?: number): Promise<{ mail: MailAccountDto[]; mailRead: MailReadDto }> => {
    const by = new Map<string, MailAccountDto>();
    for (const p of await registry()) {
      for (const account of p.config.mail.accounts) {
        const row = by.get(account.toLowerCase()) ?? { account, foundInMail: null, usedBy: [] };
        if (!row.usedBy.includes(p.slug)) row.usedBy.push(p.slug);
        by.set(account.toLowerCase(), row);
      }
    }
    if (by.size === 0) return { mail: [], mailRead: { state: "answered", fix: null } };
    const asked = known();
    const read = withinMs === undefined ? await asked : await Promise.race([asked, new Promise<MailAccountsRead>((done) => setTimeout(() => done({ state: "not-answering" }), withinMs).unref())]);
    const mail = [...by.values()].map((r) => ({ ...r, foundInMail: read.state === "answered" ? read.accounts.includes(r.account.toLowerCase()) : null })).sort((a, b) => a.account.localeCompare(b.account));
    return { mail, mailRead: mailReadOf(read) };
  };

  const rows = async (): Promise<ConnectionRow[]> => {
    const t = o.messengers?.();
    return inspect({ dir: dir(), env, projects: await projects(), ...(t ? { telegram: { state: t.state, ...(t.project ? { project: t.project } : {}), ...(t.reason ? { reason: t.reason } : {}) } } : {}) });
  };

  return {
    async list(lo = {}) {
      const t = now();
      // The token rows and Mail's answer are read side by side: a slow Mail never holds the files back past its own budget.
      const [list, mail] = await Promise.all([rows(), mailRows(lo.mailWithinMs)]);
      return { instance: basename(hubPaths().home), connections: list.map((r) => toDto(r, cache.get(r.id), t)), ...mail };
    },
    async setSecret(id, body) {
      const row = (await rows()).find((r) => r.id === id);
      const ref = parseConnectionId(id);
      if (!row || !ref) return undefined;
      if (!row.can.includes("set")) throw new Refusal(`${row.label} cannot take a key here.`, 409);
      const d = dir();
      try {
        const problem = ref.kind === "telegram" ? (isTelegramToken(body.value) ? undefined : "that does not look like a Telegram bot token (digits, a colon, then letters and digits)") : notionShapeProblem(body.value);
        if (problem) throw new Refusal(`Not stored: ${problem}.`, 400);
        storeToken(d, ref.file, body.value);
      } catch (e) {
        // Whatever failed, the text that leaves is ours or the store's (a name, never a value); redact anyway.
        if (e instanceof Refusal) throw e;
        throw new Refusal(`Not stored: ${redact(d, e instanceof Error ? e.message : "the file could not be written")}.`, 400);
      }
      cache.delete(id);
      const after = (await rows()).find((r) => r.id === id);
      return after ? toDto(after, undefined, now()) : undefined;
    },
    async removeSecret(id) {
      const row = (await rows()).find((r) => r.id === id);
      const ref = parseConnectionId(id);
      if (!row || !ref) return undefined;
      if (row.secret.state === "from-env") throw new Refusal("This key is set by the NOTION_TOKEN environment variable. Unset it where the server is started; the hub cannot remove it.", 409);
      if (!row.can.includes("remove")) throw new Refusal(`${row.label} has no key file to remove.`, 409);
      removeSecret(dir(), ref.file);
      cache.delete(id);
      const after = (await rows()).find((r) => r.id === id);
      return after ? toDto(after, undefined, now()) : toDto({ ...row, secret: { state: "missing" }, identity: null, usedBy: [], can: [] }, undefined, now());
    },
    async test(id) {
      const row = (await rows()).find((r) => r.id === id);
      if (!row) return undefined;
      if (!row.can.includes("test")) throw new NotTestable(row.label);
      const prior = cache.get(id);
      const recent = prior && prior.changedAt === row.secret.changedAt && now().getTime() - prior.at.getTime() < minMs;
      if (!recent) {
        let run = inflight.get(id);
        if (!run) {
          run = (async () => {
            const verdict = await testConnection(dir(), env, deps, id);
            cache.set(id, { verdict, at: now(), changedAt: row.secret.changedAt });
          })().finally(() => inflight.delete(id));
          inflight.set(id, run);
        }
        await run;
      }
      const after = (await rows()).find((r) => r.id === id);
      return after ? toDto(after, cache.get(id), now()) : undefined;
    },
  };
}
