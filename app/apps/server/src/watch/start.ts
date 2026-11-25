import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { HubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import { createLlm, type Llm } from "@hub/llm";
import { errFields, ops } from "@hub/log/ops";
import { readWatch, WATCH_FILE, type WatchConfig } from "@hub/watch/config";
import { lensDataFile, lensFile, loadLensFull, stampOf, type LoadedLens } from "@hub/watch/lens";
import { createWatchQueue, createWatcher, type Watcher, type WatchQueue } from "@hub/watch/reader";
import { openWatchStore, watchDbFile, type WatchStore } from "@hub/watch/store";
import type { WatchStandingDto } from "@hub/contract/watch";
import type { TelegramUserHandle } from "../messengers/accounts/telegram-user";
import { publicReaderOf } from "./reader";
import { reloadReady, type ChangeCtx, type Source } from "./reload";

/**
 * The watch domain at start (P144, draft decision 0052). For each project with a `watch.md`: read it, load its lens from
 * `<home>/packages`, open its own store (migrated here: only the server migrates it), and start its watcher over the account's
 * connection. A project whose list or lens is broken, or whose store fails to open, parks with the reason (one ops line); the
 * server runs on. A list that is off (the default) reads nothing. The analysis runs inside the watcher's tick only.
 *
 * P153 (plan verdict 4, D2): `watch.md` and the lens's `lens.json` are read again when they change (checked every 5 s, by
 * modification time). A valid change is taken while running and written as one Activity line; an invalid one keeps what runs
 * and says why on the Watch page and in the ops log. The lens's code (`src/index.ts`) is not imported again: Node keeps a
 * module, so a code change waits for a restart, and the page says so.
 */

export type WatchProject =
  | { slug: string; state: "invalid" | "lens"; reason: string; config: WatchConfig | null }
  | { slug: string; state: "ready"; config: WatchConfig; lens: LoadedLens; store: WatchStore; watcher: Watcher; queue: WatchQueue; notice: string | null };

export interface WatchDomain {
  projects(): WatchProject[];
  project(slug: string): WatchProject | undefined;
  standing(p: WatchProject): WatchStandingDto;
  llm: Llm;
  /** One pass of the change check now (the 5-second timer's, and tests'). */
  reload(): Promise<void>;
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

export const RELOAD_EVERY_MS = 5_000;

export async function startWatch(o: StartWatch): Promise<WatchDomain> {
  const log = ops("watch");
  const llm = o.llm ?? createLlm({ ledger: o.repos.llmCalls });
  const now = o.now ?? (() => new Date());
  const timers = o.timers !== false;
  const queues = new Map<string, WatchQueue>();
  const storesOf = new Map<string, WatchStore[]>();
  const projects: WatchProject[] = [];
  const sources = new Map<string, Source>();
  const watchFileOf = (slug: string) => join(o.paths.projects, slug, WATCH_FILE);
  const slugs = existsSync(o.paths.projects) ? readdirSync(o.paths.projects, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_")).map((e) => e.name).sort() : [];

  const accountOf = (cfg: WatchConfig): string | undefined => {
    const tg = o.telegram();
    if (!tg) return undefined;
    return cfg.account === "default" ? tg.accounts()[0] : tg.accounts().find((a) => a === cfg.account);
  };
  // One queue per account: the account's rate budget is shared by every list that reads with it, and its resolve count is the
  // sum of what their watch files recorded today (P153 D4: a restart keeps it).
  const queueOf = (key: string, cfg: WatchConfig): WatchQueue => {
    const q =
      queues.get(key) ??
      createWatchQueue({
        owner: { busy: () => { const a = accountOf(cfg); return a ? (o.telegram()?.ownerBusy(a) ?? false) : false; } },
        onPark: (until, note) => log.warn("FLOOD_WAIT on the account: the watcher is parked", { until, seconds: note.seconds, by: note.by, call: note.kind }),
        resolvedOn: (day) => (storesOf.get(key) ?? []).reduce((n, s) => n + s.resolvesOn(day), 0),
      });
    queues.set(key, q);
    return q;
  };

  /** One Activity line for a change the owner (or his session) made to a watch list or a lens. */
  const activity = async (project: string, summary: string, reason: string) => {
    try {
      const at = now().toISOString();
      const runId = await o.repos.runs.start({ project, startedAt: at, finishedAt: at, trigger: "watch", skill: null, status: "ok" });
      await o.repos.runs.addEvent({ project, runId, at, kind: "decision", tool: null, summary, detail: JSON.stringify({ action: "watch_changed", reason }) });
    } catch (e) {
      log.warn("the watch change was not written to Activity", { project, ...errFields(e) });
    }
  };

  /** Reads one project's list and lens from scratch: at start, and when a parked project's files change. */
  const setup = async (slug: string): Promise<WatchProject | null> => {
    const watchStamp = stampOf(watchFileOf(slug));
    const w = readWatch(join(o.paths.projects, slug));
    if (w.state === "none") return null;
    if (w.state === "invalid") {
      log.warn("a watch list cannot be read: its watcher is parked", { project: slug, reason: w.reason });
      sources.set(slug, { module: null, watchStamp, dataStamp: 0, codeStamp: 0 });
      return { slug, state: "invalid", reason: `watch.md: ${w.reason}`, config: null };
    }
    const lens = await loadLensFull(o.paths.instancePackages, w.config.lens);
    if (!lens.ok) {
      log.warn("a watch lens did not load: its watcher is parked", { project: slug, reason: lens.reason });
      sources.set(slug, { module: null, watchStamp, dataStamp: stampOf(lensDataFile(o.paths.instancePackages, w.config.lens)), codeStamp: stampOf(lensFile(o.paths.instancePackages, w.config.lens)) });
      return { slug, state: "lens", reason: `lens ${w.config.lens}: ${lens.reason}`, config: w.config };
    }
    let store: WatchStore;
    try {
      store = openWatchStore(watchDbFile(o.paths.watch, slug), { project: slug, migrate: true });
    } catch (e) {
      log.error("the watch store did not open: its watcher is parked", { project: slug, ...errFields(e) });
      sources.set(slug, { module: null, watchStamp, dataStamp: lens.dataStamp, codeStamp: lens.codeStamp });
      return { slug, state: "invalid", reason: "the watch store did not open (see the ops log)", config: w.config };
    }
    const config = w.config;
    storesOf.set(config.account, [...(storesOf.get(config.account) ?? []), store]);
    const queue = queueOf(config.account, config);
    // The watcher reads its config from the project entry, so a reload that swaps the account's queue key is a restart's job.
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
    sources.set(slug, { module: lens.module, watchStamp, dataStamp: lens.dataStamp, codeStamp: lens.codeStamp });
    if (timers) watcher.start();
    return { slug, state: "ready", config, lens: lens.lens, store, watcher, queue, notice: null };
  };

  for (const slug of slugs) {
    const p = await setup(slug);
    if (p) projects.push(p);
  }
  log.info(`watch: ${projects.length === 0 ? "no project watches public groups" : `${projects.filter((p) => p.state === "ready" && p.config.on).length} of ${projects.length} watch list(s) on`}`);

  const replace = (slug: string, next: WatchProject | null) => {
    const i = projects.findIndex((p) => p.slug === slug);
    if (next === null) {
      if (i >= 0) projects.splice(i, 1);
    } else if (i >= 0) projects[i] = next;
    else projects.push(next);
  };

  const changeCtx: ChangeCtx = { paths: o.paths, timers, activity, bump: o.bump, watchFileOf };

  let reloading = false;
  const reload = async () => {
    if (reloading) return;
    reloading = true;
    try {
      const present = existsSync(o.paths.projects) ? readdirSync(o.paths.projects, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_")).map((e) => e.name) : [];
      for (const slug of present) {
        const p = projects.find((x) => x.slug === slug);
        const src = sources.get(slug);
        if (p?.state === "ready" && src) {
          await reloadReady(changeCtx, p, src);
          continue;
        }
        // A parked project, or one that had no watch.md: set up again when one of its files changed.
        const lensName = p?.config?.lens ?? null;
        const stamps = { watchStamp: stampOf(watchFileOf(slug)), dataStamp: lensName ? stampOf(lensDataFile(o.paths.instancePackages, lensName)) : 0, codeStamp: lensName ? stampOf(lensFile(o.paths.instancePackages, lensName)) : 0 };
        if (src && src.watchStamp === stamps.watchStamp && src.dataStamp === stamps.dataStamp && src.codeStamp === stamps.codeStamp) continue;
        if (!src && stamps.watchStamp === 0) continue;
        const next = await setup(slug);
        replace(slug, next);
        if (next?.state === "ready") await activity(slug, "Watch list started: its list and lens loaded without a restart", "watch.md or lens.json changed.");
        o.bump(slug);
      }
    } catch (e) {
      log.error("the watch change check failed", errFields(e));
    } finally {
      reloading = false;
    }
  };
  const reloadTimer = timers ? setInterval(() => void reload(), RELOAD_EVERY_MS) : null;
  reloadTimer?.unref();

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
    reload,
    stop() {
      if (reloadTimer) clearInterval(reloadTimer);
      for (const p of projects) {
        if (p.state !== "ready") continue;
        p.watcher.stop();
        p.store.close();
      }
    },
  };
}
