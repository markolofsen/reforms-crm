import { TELEGRAM_IN_TEXT } from "@hub/connections";
import type { Repos } from "@hub/db";
import { AdapterError, isParkedCode, parkedLine, type MessengerAdapter } from "./adapter";
import { ingest, type IngestResult } from "./ingest";

export interface PollDeps {
  project: string;
  adapter: MessengerAdapter;
  repos: Repos;
  now?: () => Date;
  /** Long-poll wait on the provider side. Default 30. */
  timeoutSec?: number;
  limit?: number;
}

export interface PollResult extends IngestResult {
  fetched: number;
  cursor: string | null;
}

/** Redact anything shaped like a bot token before it can reach the database or a log line. */
export const redact = (s: string): string => s.replace(TELEGRAM_IN_TEXT, "[token]");

/**
 * One poll: read the position, fetch, store, then move the position. The position moves only after the batch is
 * stored, and storing is idempotent, so a crash between the two re-delivers messages that dedupe on the remote id.
 */
export async function pollOnce(deps: PollDeps, signal?: AbortSignal): Promise<PollResult> {
  const { project, adapter, repos } = deps;
  const at = () => (deps.now ?? (() => new Date()))().toISOString();
  await repos.projects.requireProject(project);
  const acc = await repos.messengers.account(project, adapter.channel, adapter.account);
  try {
    const batch = await adapter.poll({
      cursor: acc?.cursor ?? null,
      timeoutSec: deps.timeoutSec ?? 30,
      limit: deps.limit ?? 100,
      ...(signal ? { signal } : {}),
    });
    const res = await ingest({ project, repos, ...(deps.now ? { now: deps.now } : {}) }, batch.messages);
    await repos.messengers.markPollOk(project, adapter.channel, adapter.account, batch.cursor ?? acc?.cursor ?? null, at());
    return { ...res, fetched: batch.messages.length, cursor: batch.cursor };
  } catch (err) {
    if (!signal?.aborted) await repos.messengers.markPollError(project, adapter.channel, adapter.account, redact(String(err instanceof Error ? err.message : err)), at());
    throw err;
  }
}

/** 1 s, 2 s, 4 s ... capped at 60 s, with +-20 % jitter. */
export const backoffMs = (failures: number, random: () => number = Math.random): number =>
  Math.round(Math.min(60_000, 1000 * 2 ** Math.max(0, failures - 1)) * (0.8 + 0.4 * random()));

export type PollEvent =
  | { type: "poll"; result: PollResult }
  | { type: "error"; error: Error; failures: number; retryInMs: number }
  | { type: "purged"; count: number };

export interface RunDeps extends PollDeps {
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  onEvent?: (e: PollEvent) => void;
  /** Retention purge cadence. Default 6 h; runs once at start. */
  purgeEveryMs?: number;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * The worker loop: `start()` once, then poll until aborted. Transient errors back off and retry (a provider's
 * `retry_after` wins over the schedule); `unauthorized`, `conflict` and a user account's parked codes stop the loop and
 * throw, because retrying would only fight whoever else holds the bot (or anger Telegram); a park is recorded as such.
 */
export async function runPoller(deps: RunDeps): Promise<void> {
  const { signal, adapter, repos, project } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const purgeEvery = deps.purgeEveryMs ?? 6 * 3_600_000;
  let started = false;
  let failures = 0;
  let lastPurge = Number.NEGATIVE_INFINITY;

  while (!signal?.aborted) {
    try {
      if (now().getTime() - lastPurge >= purgeEvery) {
        lastPurge = now().getTime();
        const count = await repos.messengers.purgeExpired(now().toISOString());
        if (count) deps.onEvent?.({ type: "purged", count });
      }
      if (!started) {
        await repos.projects.requireProject(project);
        await adapter.start?.();
        started = true;
      }
      const result = await pollOnce(deps, signal);
      failures = 0;
      deps.onEvent?.({ type: "poll", result });
    } catch (err) {
      if (signal?.aborted) return;
      const error = err instanceof Error ? err : new Error(String(err));
      if (error instanceof AdapterError && error.fatal) {
        const line = redact(error.message);
        await repos.messengers.markPollError(project, adapter.channel, adapter.account, isParkedCode(error.code) ? parkedLine(error.code, line) : line);
        throw error;
      }
      failures++;
      const retryInMs = error instanceof AdapterError && error.retryAfterMs ? error.retryAfterMs : backoffMs(failures, deps.random);
      deps.onEvent?.({ type: "error", error, failures, retryInMs });
      await sleep(retryInMs, signal);
    }
  }
}
