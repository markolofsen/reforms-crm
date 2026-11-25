import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { HubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import { createLlm, type Llm } from "@hub/llm";
import { errFields, ops } from "@hub/log/ops";
import { readWatch, type WatchConfig } from "@hub/watch/config";
import { loadLens, type LoadedLens } from "@hub/watch/lens";
import { createWatchQueue, createWatcher, type Watcher, type WatchQueue } from "@hub/watch/reader";
import { openWatchStore, watchDbFile, type WatchStore } from "@hub/watch/store";
import type { WatchStandingDto } from "@hub/contract/watch";
import type { TelegramUserHandle } from "../messengers/accounts/telegram-user";
import { publicReaderOf } from "./reader";

/**
 * The watch domain at start (P144, draft decision 0052). For each project with a `watch.md`: read it, load its lens from
 * `<home>/packages`, open its own store (migrated here: only the server migrates it), and start its watcher over the account's
 * connection. A project whose list or lens is broken, or whose store fails to open, parks with the reason (one ops line); the
 * server runs on. A list that is off (the default) reads nothing. The analysis runs inside the watcher's tick only.
 */

export type WatchProject =
  | { slug: string; state: "invalid" | "lens"; reason: string; config: WatchConfig | null }
  | { slug: string; state: "ready"; config: WatchConfig; lens: LoadedLens; store: WatchStore; watcher: Watcher; queue: WatchQueue };

export interface WatchDomain {
  projects(): WatchProject[];
  project(slug: string): WatchProject | undefined;
  standing(p: WatchProject): WatchStandingDto;
  llm: Llm;
  stop(): void;
}

export interface StartWatch {
  repos: Repos;
  paths: Pick<HubPaths, "projects" | "instancePackages" | "watch">;
  /** The user-account supervisor, bound once it has started. */
  telegram: () => TelegramUserHandle | undefined;
  /** A write landed for this project: bump the `watch` live topic. */
  bump: (project: string) => void;
  llm?: Llm;
  now?: () => Date;
  /** Tests: do not start the timers. */
  timers?: boolean;
}

export async function startWatch(o: StartWatch): Promise<WatchDomain> {
  const log = ops("watch");
  const llm = o.llm ?? createLlm({ ledger: o.repos.llmCalls });
  const now = o.now ?? (() => new Date());
  const queues = new Map<string, WatchQueue>();
  const projects: WatchProject[] = [];
  const slugs = existsSync(o.paths.projects) ? readdirSync(o.paths.projects, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_")).map((e) => e.name).sort() : [];

  const accountOf = (cfg: WatchConfig): string | undefined => {
    const tg = o.telegram();
    if (!tg) return undefined;
    return cfg.account === "default" ? tg.accounts()[0] : tg.accounts().find((a) => a === cfg.account);
  };
  // One queue per account: the account's rate budget is shared by every list that reads with it.
  const queueOf = (key: string, cfg: WatchConfig): WatchQueue => {
    const q = queues.get(key) ?? createWatchQueue({ owner: { busy: () => { const a = accountOf(cfg); return a ? (o.telegram()?.ownerBusy(a) ?? false) : false; } }, onPark: (until, note) => log.warn("FLOOD_WAIT on the account: the watcher is parked", { until, seconds: note.seconds, by: note.by, call: note.kind }) });
    queues.set(key, q);
    return q;
  };

  for (const slug of slugs) {
    const w = readWatch(join(o.paths.projects, slug));
    if (w.state === "none") continue;
    if (w.state === "invalid") {
      log.warn("a watch list cannot be read: its watcher is parked", { project: slug, reason: w.reason });
      projects.push({ slug, state: "invalid", reason: `watch.md: ${w.reason}`, config: null });
      continue;
    }
    const lens = await loadLens(o.paths.instancePackages, w.config.lens);
    if (!lens.ok) {
      log.warn("a watch lens did not load: its watcher is parked", { project: slug, reason: lens.reason });
      projects.push({ slug, state: "lens", reason: `lens ${w.config.lens}: ${lens.reason}`, config: w.config });
      continue;
    }
    let store: WatchStore;
    try {
      store = openWatchStore(watchDbFile(o.paths.watch, slug), { project: slug, migrate: true });
    } catch (e) {
      log.error("the watch store did not open: its watcher is parked", { project: slug, ...errFields(e) });
      projects.push({ slug, state: "invalid", reason: "the watch store did not open (see the ops log)", config: w.config });
      continue;
    }
    const config = w.config;
    const queue = queueOf(config.account, config);
    const watcher = createWatcher({
      project: slug,
      config,
      lens: lens.lens,
      store,
      llm,
      queue,
      now,
      reader: () => {
        const a = accountOf(config);
        const mt = a ? o.telegram()?.publicClient(a) : undefined;
        return mt ? publicReaderOf(mt) : null;
      },
      onWritten: () => o.bump(slug),
    });
    projects.push({ slug, state: "ready", config, lens: lens.lens, store, watcher, queue });
    if (o.timers !== false) watcher.start();
  }
  log.info(`watch: ${projects.length === 0 ? "no project watches public groups" : `${projects.filter((p) => p.state === "ready" && p.config.on).length} of ${projects.length} watch list(s) on`}`);

  const standing = (p: WatchProject): WatchStandingDto => {
    if (p.state !== "ready") return { state: p.state, reason: p.reason, until: null };
    const s = p.watcher.state();
    if (s.state === "off") return { state: "off", reason: "The watch list is off: say so to the agent (watch.md, on: yes) to start reading.", until: null };
    if (s.state === "no_account") return { state: "no_account", reason: "No Telegram user account is connected for this watch list (Messengers ▸ Settings).", until: null };
    if (s.state === "parked") return { state: "parked", reason: s.why, until: s.until };
    return { state: "polling", reason: null, until: null };
  };

  return {
    projects: () => projects,
    project: (slug) => projects.find((p) => p.slug === slug),
    standing,
    llm,
    stop() {
      for (const p of projects) {
        if (p.state !== "ready") continue;
        p.watcher.stop();
        p.store.close();
      }
    },
  };
}
