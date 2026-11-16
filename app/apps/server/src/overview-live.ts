import { classifyNotionError, countPages, createNotionReader, loadToken, secretsDir, type ReaderOptions } from "@hub/notion";
import { countNewSince, windowStart, type ImapAccount, type ImapConnect, type ImapSession } from "@hub/mail/imap";
import { FRESH_MINUTES, MIN_REFRESH_SECONDS, type LiveSource, type MailboxDto, type NotionDto, type ReadErrorCode } from "@hub/contract/overview";
import { join } from "node:path";

/**
 * The live half of the Overview: Mail and Notion numbers that cost a network round trip. They are read only on an
 * explicit refresh (`POST /api/overview/refresh`), kept in memory with the time they were read, and shown with a state:
 * fresh (under the TTL), stale (over it, still shown), never (not read since the server started), refreshing, error
 * (the last good number is kept beside the reason and a fix line). A restart empties the cache on purpose: a number
 * nobody refreshed must not look current, and no second copy of a Notion fact is written anywhere.
 * Nothing here writes: IMAP search and header fetches, Notion data source queries (a POST that only reads).
 */

export type MailBlock = MailboxDto["newSinceTriage"];
type NotionSource = NonNullable<NotionDto["clients"]>;
export type NotionBlock = NotionSource["count"];
type MailValue = { count: number; since: string; mayOverstate: boolean };
type NotionValue = { count: number; capped: boolean };
type Failure = { code: ReadErrorCode; message: string; fix: string };

export type NotionSourceName = "clients" | "leads";
export type RefreshOutcome = "read" | "joined" | "too-soon";

/** What one project's refresh reads. The service builds it from `project.md` and the project's folder. */
export interface RefreshPlan {
  project: string;
  sources: readonly LiveSource[];
  /** Account names listed under `mail.accounts`. */
  accounts: string[];
  /** The project's own addresses (`mail.addresses`): their mail is outbound. */
  addresses: string[];
  /** True for a sender the project's filter rules call a non-client. Absent: no filter rules. */
  excluded?: (m: { from: string; subject: string }) => boolean;
  /** Start of the last triage, or null. */
  triageAt: Date | null;
  notion: { tokenFile: string; sources: { name: NotionSourceName; id: string }[] };
}

export interface LiveOptions {
  now: () => Date;
  /** The logins the project may read and how to connect; absent: every mailbox is `off`. */
  accountsFor?: (project: string) => Promise<ImapAccount[]>;
  connect?: ImapConnect;
  env?: NodeJS.ProcessEnv;
  /** Tests: the stub fetch and a no-op sleep for the Notion reader. */
  notionReader?: Pick<ReaderOptions, "fetch" | "sleep" | "now">;
  mailTimeoutMs?: number;
  notionTimeoutMs?: number;
  minIntervalMs?: number;
}

interface Entry<V> {
  value?: V;
  asOf?: number;
  error?: Failure;
}

class Timeout extends Error {}
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Timeout()), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e)),
    );
  });

const RETRY = "Check the network, then Refresh.";

function mailFailure(e: unknown, ms: number): Failure {
  if (e instanceof Timeout) return { code: "timeout", message: `The mailbox did not answer within ${Math.round(ms / 1000)} s.`, fix: RETRY };
  // The server's own text can echo a login, so it is read here to classify and never kept or shown.
  const text = e instanceof Error ? e.message : "";
  if (/auth|credential|login|password|invalid|denied|rejected/i.test(text)) {
    return { code: "login-refused", message: "The mailbox refused the sign-in.", fix: "Fix the login file for this account in state/secrets (password or token), then Refresh." };
  }
  if (/econn|enotfound|eai_again|etimedout|getaddrinfo|socket|network|certificate|unavailable/i.test(text)) return { code: "unreachable", message: "The mail server could not be reached.", fix: RETRY };
  return { code: "failed", message: "The mailbox could not be read.", fix: RETRY };
}

function notionFailure(e: unknown, project: string, tokenFile: string): Failure {
  if (e instanceof Timeout) return { code: "timeout", message: "Notion did not answer in time.", fix: RETRY };
  switch (classifyNotionError(e)) {
    case "token-rejected":
      return { code: "token-rejected", message: "Notion rejected the token.", fix: `Replace the token in state/secrets/${tokenFile} with a working integration token, then run \`hub doctor ${project}\`. Manual sessions work without it, through the Notion connector.` };
    case "not-shared":
      return { code: "not-shared", message: "The Notion integration cannot see this data source.", fix: "Share the project's Notion teamspace page with the integration (Notion: ... > Connections), then Refresh." };
    case "unreachable":
      return { code: "unreachable", message: "Notion could not be reached.", fix: RETRY };
    case "failed":
      return { code: "failed", message: "Notion could not be read.", fix: RETRY };
  }
}

export const tokenMissing = (project: string, tokenFile: string): Failure => ({
  code: "token-missing",
  message: "The Notion token is missing.",
  fix: `Put the token alone in state/secrets/${tokenFile} (chmod 600), then run \`hub doctor ${project}\`. Manual sessions work without it, through the Notion connector.`,
});

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHARED_TOKEN = "notion-token";

export function createLiveReads(o: LiveOptions) {
  const env = o.env ?? process.env;
  const minMs = o.minIntervalMs ?? MIN_REFRESH_SECONDS * 1000;
  const mailMs = o.mailTimeoutMs ?? 10_000;
  const notionMs = o.notionTimeoutMs ?? 30_000;
  const ttl = { mail: FRESH_MINUTES.mail * 60_000, notion: FRESH_MINUTES.notion * 60_000 };
  const entries = new Map<string, Entry<MailValue | NotionValue>>();
  const flights = new Map<string, Promise<void>>();
  const attempts = new Map<string, number>();
  const key = (...parts: string[]) => parts.join("\u0000");

  /** A project with its own token file never falls back to the shared token or to NOTION_TOKEN. */
  const tokenEnv = (tokenFile: string): NodeJS.ProcessEnv => (tokenFile === SHARED_TOKEN ? env : { ...env, NOTION_TOKEN: "" });
  const tokenPath = (tokenFile: string) => join(secretsDir(env), tokenFile);

  async function tokenPresent(tokenFile: string): Promise<boolean> {
    if (!SAFE_FILE.test(tokenFile)) return false;
    try {
      await loadToken(tokenEnv(tokenFile), tokenPath(tokenFile));
      return true;
    } catch {
      return false;
    }
  }

  function stateOf<V>(e: Entry<V> | undefined, running: boolean, ttlMs: number) {
    const kept = e?.value !== undefined && e.asOf !== undefined ? { asOf: new Date(e.asOf).toISOString(), value: e.value } : null;
    if (running) return { state: "refreshing" as const, ...(kept ?? {}) };
    if (e?.error) return { state: "error" as const, ...e.error, ...(kept ?? {}) };
    if (kept && e?.asOf !== undefined) return { state: o.now().getTime() - e.asOf < ttlMs ? ("fresh" as const) : ("stale" as const), ...kept };
    return { state: "never" as const };
  }

  /** Lower-cased names of the accounts the project lists and a login file covers. Reads local files only. */
  async function logins(project: string): Promise<Set<string>> {
    try {
      return new Set(((await o.accountsFor?.(project)) ?? []).map((a) => a.name.toLowerCase()));
    } catch {
      return new Set();
    }
  }

  function mailBlock(project: string, account: string, hasLogin: boolean): MailBlock {
    if (!hasLogin) return { state: "off", message: "No login for this account." };
    const e = entries.get(key(project, "mail", account.toLowerCase()));
    const s = stateOf(e as Entry<MailValue> | undefined, flights.has(key(project, "mail")), ttl.mail);
    return s;
  }

  function notionBlock(project: string, source: NotionSourceName, tokenFile: string, hasToken: boolean): NotionBlock {
    const e = entries.get(key(project, "notion", source)) as Entry<NotionValue> | undefined;
    const s = stateOf(e, flights.has(key(project, "notion")), ttl.notion);
    // A missing token is a setup defect, seen without any network call; the last good number stays beside it.
    if (!hasToken && s.state !== "refreshing") {
      const kept = "value" in s && "asOf" in s ? { asOf: s.asOf, value: s.value } : {};
      return { state: "error", ...tokenMissing(project, tokenFile), ...kept };
    }
    return s;
  }

  async function readMail(plan: RefreshPlan): Promise<void> {
    const logins = (await o.accountsFor?.(plan.project)) ?? [];
    const since = windowStart(o.now(), plan.triageAt);
    for (const a of logins) {
      const k = key(plan.project, "mail", a.name.toLowerCase());
      const prev = entries.get(k);
      let session: ImapSession | undefined;
      let cancelled = false;
      try {
        const connect = o.connect;
        if (!connect) throw new Error("unavailable");
        const r = await withTimeout(
          (async () => {
            const s = await connect(a);
            session = s;
            if (cancelled) throw new Timeout();
            return countNewSince(a, s, { since, me: plan.addresses, ...(plan.excluded ? { excluded: plan.excluded } : {}) });
          })(),
          mailMs,
        );
        entries.set(k, { value: { count: r.count, since: since.toISOString(), mayOverstate: !plan.excluded || !r.answersChecked }, asOf: o.now().getTime() });
      } catch (e) {
        cancelled = true;
        entries.set(k, { ...prev, error: mailFailure(e, mailMs) });
      } finally {
        await session?.close().catch(() => {});
      }
    }
  }

  async function readNotion(plan: RefreshPlan): Promise<void> {
    const { tokenFile, sources } = plan.notion;
    if (sources.length === 0) return;
    const fail = (name: NotionSourceName, f: Failure) => entries.set(key(plan.project, "notion", name), { ...entries.get(key(plan.project, "notion", name)), error: f });
    let token: string;
    try {
      if (!SAFE_FILE.test(tokenFile)) throw new Error("bad token file name");
      token = await loadToken(tokenEnv(tokenFile), tokenPath(tokenFile));
    } catch {
      for (const s of sources) fail(s.name, tokenMissing(plan.project, tokenFile));
      return;
    }
    const reader = createNotionReader(token, o.notionReader ?? {});
    let stop: Failure | null = null;
    for (const s of sources) {
      if (stop) {
        fail(s.name, stop);
        continue;
      }
      try {
        const r = await withTimeout(countPages(reader, s.id), notionMs);
        entries.set(key(plan.project, "notion", s.name), { value: { count: r.count, capped: r.capped }, asOf: o.now().getTime() });
      } catch (e) {
        const f = notionFailure(e, plan.project, tokenFile);
        fail(s.name, f);
        // A rejected token fails every source the same way: do not ask again.
        if (f.code === "token-rejected") stop = f;
      }
    }
  }

  /**
   * One source of one project: single flight (a second call while a read runs shares it), at least `MIN_REFRESH_SECONDS`
   * between two reads (the earlier result is returned), mail accounts and data sources one after the other.
   */
  async function refreshOne(plan: RefreshPlan, source: LiveSource): Promise<RefreshOutcome> {
    const k = key(plan.project, source);
    const running = flights.get(k);
    if (running) {
      await running;
      return "joined";
    }
    const last = attempts.get(k);
    if (last !== undefined && o.now().getTime() - last < minMs) return "too-soon";
    attempts.set(k, o.now().getTime());
    const run = (source === "mail" ? readMail(plan) : readNotion(plan)).finally(() => flights.delete(k));
    flights.set(k, run);
    await run;
    return "read";
  }

  async function refresh(plan: RefreshPlan): Promise<Partial<Record<LiveSource, RefreshOutcome>>> {
    const out: Partial<Record<LiveSource, RefreshOutcome>> = {};
    for (const source of new Set(plan.sources)) out[source] = await refreshOne(plan, source);
    return out;
  }

  return { mailBlock, notionBlock, tokenPresent, logins, refresh };
}

export type LiveReads = ReturnType<typeof createLiveReads>;

/** The `asOf` of a block, when it has one. */
export const asOfOf = (b: { state: string; asOf?: string }): string | null => b.asOf ?? null;
