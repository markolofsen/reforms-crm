import { join } from "node:path";
import type { HubPaths } from "@hub/config/paths";
import { ops } from "@hub/log/ops";
import { accountJournal } from "@hub/watch/account-state";
import type { WatchConfig } from "@hub/watch/config";
import { readWatchPolicy, watchPolicyFile, type WatchPolicyRead } from "@hub/watch/policy";
import { createWatchQueue, type WatchQueue } from "@hub/watch/reader";
import type { WatchStore } from "@hub/watch/store";
import type { TelegramUserHandle } from "../../messengers/accounts/telegram-user";

interface Options {
  paths: Pick<HubPaths, "projects" | "watch"> & Partial<Pick<HubPaths, "stateProjects">>;
  telegram: () => TelegramUserHandle | undefined;
  now: () => Date;
}

/** Canonical account queues and their durable state, shared even when watch lists spell the account as default or an id. */
export function membershipRuntime(o: Options) {
  const journal = accountJournal(join(o.paths.watch, "_accounts.json"));
  const queues = new Map<string, WatchQueue>();
  const entries = new Map<string, { store: WatchStore; config: () => WatchConfig }>();
  const accountOf = (config: WatchConfig): string | undefined => {
    const ids = o.telegram()?.accounts() ?? [];
    return config.account === "default" ? ids[0] : ids.find((id) => id === config.account);
  };
  const policyFor = (slug: string): WatchPolicyRead => o.paths.stateProjects
    ? readWatchPolicy(join(o.paths.projects, slug), watchPolicyFile(o.paths.stateProjects, slug)) : { state: "none" };
  const limitFor = (account: string): number => {
    const limits = [...entries.keys()].flatMap((slug) => {
      const p = policyFor(slug);
      return p.state === "ok" && p.policy.enabled && p.policy.account === account ? [p.policy.limits.joinsPerDay] : [];
    });
    return limits.length ? Math.min(...limits) : 3;
  };
  const queueOf = (key: string): WatchQueue => {
    const existing = queues.get(key);
    if (existing) return existing;
    const queue = createWatchQueue({
      owner: { busy: () => o.telegram()?.ownerBusy(key) ?? false }, clock: { now: () => o.now().getTime() },
      ...(key.startsWith("unconnected:") ? {} : { account: { id: key, journal, joinsPerDay: () => limitFor(key) } }),
      resolvedOn: (day) => [...entries.values()].filter((e) => accountOf(e.config()) === key).reduce((n, e) => n + e.store.resolvesOn(day), 0),
      onPark: (until, note) => ops("watch").warn("FLOOD_WAIT on the account: Watch is parked", { until, seconds: note.seconds, by: note.by, call: note.kind }),
    });
    queues.set(key, queue);
    return queue;
  };
  const queueForConfig = (config: WatchConfig): WatchQueue => {
    const current = () => queueOf(accountOf(config) ?? `unconnected:${config.account}`);
    return { run: (kind, call) => current().run(kind, call), parkedUntil: () => current().parkedUntil(), lastFlood: () => current().lastFlood(),
      resolvesLeft: () => current().resolvesLeft(), resetRun: () => current().resetRun(), joinStatus: () => current().joinStatus(),
      park: (seconds, kind) => current().park(seconds, kind), parkReason: () => current().parkReason() };
  };
  return { accountOf, policyFor, queueForConfig,
    register: (slug: string, store: WatchStore, config: () => WatchConfig) => entries.set(slug, { store, config }),
    queueForAccount: (id: string): WatchQueue | null => (o.telegram()?.accounts() ?? []).includes(id) ? queueOf(id) : null,
    joinStatusFor: (id: string) => /^[0-9]{3,20}$/.test(id) ? queueOf(id).joinStatus() : null,
  };
}
