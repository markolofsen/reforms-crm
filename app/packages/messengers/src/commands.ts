import type { Repos } from "@hub/db";
import type { MessengerAdapter } from "./adapter";
import { pollOnce, runPoller, type PollEvent } from "./poller";
import { CHANNELS } from "./types";

/** A poll with no success for this long is reported as stale (a laptop asleep, a dead bot, a revoked token). */
export const STALE_AFTER_MS = 10 * 60_000;

export async function statusLines(repos: Repos, project: string, now: Date = new Date()): Promise<string[]> {
  await repos.projects.requireProject(project);
  const out: string[] = [`project: ${project}`];
  const accounts = await repos.messengers.accounts(project);
  if (accounts.length === 0) out.push("accounts: none polled yet");
  for (const a of accounts) {
    const age = a.lastOkAt ? now.getTime() - Date.parse(a.lastOkAt) : null;
    const health = age === null ? "never polled" : age > STALE_AFTER_MS ? `STALE (last ok ${a.lastOkAt})` : `ok (last ${a.lastOkAt})`;
    out.push(`${a.channel} bot ${a.account}: ${health}, cursor ${a.cursor ?? "-"}`);
    if (a.lastError) out.push(`  last error ${a.lastErrorAt}: ${a.lastError}`);
  }
  const chats = await repos.messengers.allowedChats(project);
  out.push(`allow-list: ${chats.length} chat(s)${chats.length ? " - " + chats.map((c) => `${c.channel}:${c.chatId}${c.title ? ` (${c.title})` : ""}`).join(", ") : ""}`);
  const counts = await repos.messengers.messageCounts(project);
  out.push(counts.length ? `messages: ${counts.map((c) => `${c.channel} ${c.n} (newest ${c.newest})`).join(", ")}` : "messages: none stored");
  const open = await repos.messengers.listDrafts(project, ["draft", "confirmed"]);
  out.push(`drafts waiting: ${open.filter((d) => d.status === "draft").length} to approve, ${open.filter((d) => d.status === "confirmed").length} approved not sent`);
  out.push(`send: ${(Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]).map((c) => `${c} ${CHANNELS[c].canSend ? "yes (after approval)" : "never (copy + open chat)"}`).join("; ")}`);
  return out;
}

export function pollLine(e: PollEvent): string {
  switch (e.type) {
    case "poll":
      return `poll: fetched ${e.result.fetched}, stored ${e.result.stored}, duplicate ${e.result.duplicates}${e.result.dropped.map((d) => `; dropped ${d.count} from unlisted ${d.channel} chat ${d.chatId}${d.title ? ` (${d.title})` : ""}`).join("")}`;
    case "error":
      return `poll error (${e.failures}): ${e.error.message}; retry in ${Math.round(e.retryInMs / 1000)} s`;
    case "purged":
      return `purged ${e.count} message(s) past retention`;
  }
}

export interface PollCommand {
  repos: Repos;
  project: string;
  adapter: MessengerAdapter;
  once: boolean;
  signal?: AbortSignal;
  log: (line: string) => void;
}

/** `poll --once`: start, one poll with a short wait, report. Without `--once`: the worker loop until aborted. */
export async function pollCommand(c: PollCommand): Promise<void> {
  if (!c.once) {
    await runPoller({ repos: c.repos, project: c.project, adapter: c.adapter, ...(c.signal ? { signal: c.signal } : {}), onEvent: (e) => c.log(pollLine(e)) });
    return;
  }
  await c.repos.projects.requireProject(c.project);
  await c.adapter.start?.();
  const result = await pollOnce({ repos: c.repos, project: c.project, adapter: c.adapter, timeoutSec: 0 });
  c.log(pollLine({ type: "poll", result }));
}
