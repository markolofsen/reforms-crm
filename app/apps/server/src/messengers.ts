import { access, readFile } from "node:fs/promises";
import { isTelegramToken } from "@hub/connections";
import { botTokenFile, redact, runPoller, telegramPollAdapter, type MessengerAdapter, type PollEvent } from "@hub/messengers";
import type { Repos } from "@hub/db";
import { ops } from "@hub/log/ops";

/**
 * The messengers poller inside the server: receive only. It is handed a `pollOnly` adapter (no outbound call exists
 * on it), reads one bot token file, and is off unless that file is there. Status goes to `/api/health`.
 */
export type MessengersState = "off" | "starting" | "running" | "error" | "stopped";

export interface MessengersStatus {
  state: MessengersState;
  reason?: string;
  project?: string;
  lastPollAt?: string;
  lastError?: string;
  failures: number;
  stored: number;
}

export const OFF: MessengersStatus = { state: "off", reason: "not started", failures: 0, stored: 0 };

export interface MessengersHandle {
  status(): MessengersStatus;
  stop(): Promise<void>;
  /** Resolves when the loop has ended (tests). */
  done: Promise<void>;
}

export interface StartMessengers {
  repos: Repos;
  env?: NodeJS.ProcessEnv;
  tokenFile?: string;
  /** Builds the receive-only adapter from a token. Default: grammY through `telegramPollAdapter`. */
  adapterFor?: (token: string) => Promise<MessengerAdapter> | MessengerAdapter;
  runner?: typeof runPoller;
  now?: () => Date;
}

const off = (reason: string, project?: string): MessengersHandle => ({
  status: () => ({ state: "off", reason, ...(project ? { project } : {}), failures: 0, stored: 0 }),
  stop: async () => {},
  done: Promise.resolve(),
});

/**
 * The one project a messenger account stores into: `HUB_MESSENGERS_PROJECT`, else the only registered project. Shared by the bot
 * and the Telegram user accounts (P71), since each instance has one project today.
 */
export async function messengersProject(repos: Repos, env: NodeJS.ProcessEnv): Promise<{ project: string; reason?: undefined; named?: undefined } | { project: null; reason: string; named?: string }> {
  const slugs = (await repos.projects.registry()).projects.map((p) => p.slug);
  const project = env.HUB_MESSENGERS_PROJECT ?? (slugs.length === 1 ? slugs[0] : undefined);
  if (!project) return { project: null, reason: slugs.length ? "several projects: set HUB_MESSENGERS_PROJECT" : "no project registered" };
  if (!slugs.includes(project)) return { project: null, reason: `project "${project}" is not registered`, named: project };
  return { project };
}

export async function startMessengers(o: StartMessengers): Promise<MessengersHandle> {
  const env = o.env ?? process.env;
  if (env.HUB_MESSENGERS === "off") return off("HUB_MESSENGERS=off");
  const file = o.tokenFile ?? env.HUB_TELEGRAM_TOKEN_FILE ?? botTokenFile(env);
  try {
    await access(file);
  } catch {
    return off("no bot token file");
  }
  let token: string;
  try {
    token = (await readFile(file, "utf8")).trim();
  } catch {
    return off("bot token file is not readable");
  }
  if (!isTelegramToken(token)) return off("bot token file is not a Telegram token");

  const pick = await messengersProject(o.repos, env);
  if (pick.project === null) return off(pick.reason, pick.named);
  const project = pick.project;

  const st: MessengersStatus = { state: "starting", project, failures: 0, stored: 0 };
  const ac = new AbortController();
  const now = o.now ?? (() => new Date());
  const onEvent = (e: PollEvent) => {
    if (e.type === "poll") {
      st.state = "running";
      st.failures = 0;
      delete st.lastError;
      st.lastPollAt = now().toISOString();
      st.stored += e.result.stored ?? 0;
    } else if (e.type === "error") {
      st.failures = e.failures;
      st.lastError = redact(e.error.message);
      st.state = "error";
    }
  };
  const run = o.runner ?? runPoller;
  const done = (async () => {
    try {
      const adapter = await (o.adapterFor ? o.adapterFor(token) : telegramPollAdapter(token));
      await run({ repos: o.repos, project, adapter, signal: ac.signal, onEvent, now });
      if (st.state !== "error") st.state = "stopped";
    } catch (e) {
      st.state = "error";
      st.lastError = redact(e instanceof Error ? e.message : String(e));
      ops("telegram_bot").error("the bot's receiver stopped", { reason: st.lastError });
    }
  })();
  return {
    status: () => ({ ...st }),
    stop: async () => {
      ac.abort();
      await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
      if (st.state !== "error") st.state = "stopped";
    },
    done,
  };
}
