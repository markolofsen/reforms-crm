import { basename } from "node:path";
import { hubPaths } from "@hub/config/paths";
import { inspect, testConnection, type ConnectionRow, type ProbeDeps, type ProjectUse, type Verdict } from "@hub/connections";
import { CONNECTION_FRESH_MINUTES, type CheckValueDto, type ConnectionDto, type ConnectionsDto } from "@hub/contract/connections";
import type { ReadErrorCode } from "@hub/contract/overview";
import { MIN_REFRESH_SECONDS } from "@hub/contract/overview";
import type { Repos } from "@hub/db";
import { FakeImapServer, type ImapAccount, type ImapConnect } from "@hub/mail/imap";
import { configOf } from "./overview-facts";
import type { MessengersStatus } from "./messengers";

/**
 * The Connections panel's service. A list reads files and settings only (no network). A test is one probe of one connection, kept in server
 * memory with its time: two tests of one connection closer than MIN_REFRESH_SECONDS share the earlier result, and one in flight is shared.
 * A cached result belongs to the secret it tested: when the file's change time moves, the result is dropped. No value is ever returned.
 */
export interface ConnectionsService {
  list(): Promise<ConnectionsDto>;
  /** `undefined`: no such connection. Throws `NotTestable` when the row offers no Test. */
  test(id: string): Promise<ConnectionDto | undefined>;
}

export class NotTestable extends Error {
  constructor(what: string) {
    super(`${what} has nothing to test: store a login first, or fix the file.`);
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
}

interface Cached { verdict: Verdict; at: Date; changedAt: string | undefined }

/** `HUB_CONNECTIONS_PROBE`: unset is the real probes; `fake` is a stub that never leaves the process and is refused without a throwaway database (the rule of HUB_MAILER=fake). */
export function chooseProbeKind(env: NodeJS.ProcessEnv): "real" | "fake" {
  const v = env.HUB_CONNECTIONS_PROBE;
  if (v === undefined || v === "") return "real";
  if (v !== "fake") throw new Error(`HUB_CONNECTIONS_PROBE must be unset or exactly "fake", got "${v}"`);
  if (!env.HUB_DB || env.HUB_DB === ":memory:") throw new Error("HUB_CONNECTIONS_PROBE=fake needs HUB_DB set to a throwaway database file: the default database is the live one");
  return "fake";
}

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
  const imapConnect: ImapConnect = (a: ImapAccount) => {
    const secret = "pass" in a.auth ? a.auth.pass : a.auth.accessToken;
    if (secret.includes("REJECT")) return Promise.reject(Object.assign(new Error("fake login refused"), { authenticationFailed: true }));
    return new FakeImapServer({ [a.name]: { INBOX: { messages: [] } } }).connect(a);
  };
  return { fetch: fetchFake, imapConnect };
}

const FIX: Record<ConnectionRow["kind"], string> = {
  notion: "Replace the token in this row with a working integration token.",
  mail: "Replace the app password in this row.",
  telegram: "Replace the bot token in this row with the token of a bot made in BotFather.",
  whatsapp: "",
};

function errorCode(kind: ConnectionRow["kind"], v: Verdict): ReadErrorCode {
  if (v.state === "unverified") return "unreachable";
  return kind === "mail" ? "login-refused" : /no secret|empty/.test(v.detail) ? "token-missing" : "token-rejected";
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
  return { ...base, check: { state: "error", code: errorCode(row.kind, verdict), message: verdict.detail, fix: verdict.state === "unverified" ? "Check the network, then Test again." : FIX[row.kind], asOf } };
};

export function createConnections(o: ConnectionsOptions): ConnectionsService {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  const minMs = o.minIntervalMs ?? MIN_REFRESH_SECONDS * 1000;
  const dir = o.dir ?? (() => hubPaths().secrets);
  const deps: ProbeDeps = o.deps ?? { fetch };
  const cache = new Map<string, Cached>();
  const inflight = new Map<string, Promise<void>>();

  const projects = o.projects ?? (async (): Promise<ProjectUse[]> =>
    (await o.repos.projects.registry()).projects.map((p) => {
      const c = configOf(p);
      return { slug: p.slug, mailAccounts: c.mail.accounts, notionTokenFile: c.notion.tokenFile };
    }));

  const rows = async (): Promise<ConnectionRow[]> => {
    const t = o.messengers?.();
    return inspect({ dir: dir(), env, projects: await projects(), ...(t ? { telegram: { state: t.state, ...(t.project ? { project: t.project } : {}), ...(t.reason ? { reason: t.reason } : {}) } } : {}) });
  };

  return {
    async list() {
      const t = now();
      return { instance: basename(hubPaths().home), connections: (await rows()).map((r) => toDto(r, cache.get(r.id), t)) };
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
