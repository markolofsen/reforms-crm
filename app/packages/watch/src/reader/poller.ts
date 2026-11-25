import type { Llm } from "@hub/llm";
import { errFields, ops } from "@hub/log/ops";
import { analyseGroup, analysisDue, type GroupAnalysis } from "../analyse/job";
import type { WatchConfig } from "../config";
import type { LoadedLens } from "../lens/load";
import type { WatchStore } from "../store/repo";
import { WatchBudgetSpent, WatchParked, type WatchQueue } from "./queue";
import { FloodWaitError, type PublicMessage, type PublicPeer, type PublicReader } from "./types";

/**
 * One project's watcher (P144 W4 and W5): a tick polls each group whose time has come (every `poll_minutes`; the queue's 3-second gap
 * keeps the groups staggered), stores what is new, and runs the window analysis of a group that is due. Every Telegram call
 * goes through the account's watch queue (`queue.ts`); the reader may be absent (no connected account), and then nothing is
 * read. Reading is without joining: a group that refuses its history until joined shows "must be joined" and waits for the
 * owner's Join. A watch list that is off polls nothing. The retention runs once a day.
 */

export { createWatchQueue, type WatchQueue } from "./queue";
export { FloodWaitError, type OwnerActivity, type PublicMessage, type PublicPeer, type PublicReader } from "./types";

/** Messages per history pull. */
export const PULL_LIMIT = 100;
/** A tick of the watcher: frequent enough to keep 5-minute polls staggered, cheap when nothing is due. */
export const TICK_MS = 30_000;

export type WatcherState = { state: "off" } | { state: "no_account" } | { state: "parked"; until: string; why: string } | { state: "polling" };

export interface Watcher {
  readonly project: string;
  /** One pass now (the timer's, and tests'). Never throws. */
  tick(): Promise<void>;
  /** The owner's Join button for one group. */
  join(username: string): Promise<{ ok: true; access: "joined" | "pending" } | { ok: false; reason: string }>;
  state(): WatcherState;
  start(): void;
  stop(): void;
}

export interface WatcherDeps {
  project: string;
  config: WatchConfig;
  lens: LoadedLens;
  store: WatchStore;
  llm: Llm;
  /** The account's reader through the supervisor's client, or null while no account is connected. */
  reader: () => PublicReader | null;
  queue: WatchQueue;
  now?: () => Date;
  /** A write landed: the server bumps the `watch` live topic. */
  onWritten?: () => void;
  onAnalysed?: (username: string, a: GroupAnalysis) => void;
}

const peerOf = (g: { peerId: string | null; title: string | null }): PublicPeer | null => (g.peerId ? { peerId: g.peerId, title: g.title } : null);

export function createWatcher(d: WatcherDeps): Watcher {
  const now = d.now ?? (() => new Date());
  const log = ops("watch");
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let lastRetention = "";
  d.store.ensureGroups(d.config.groups, now());

  // The queue spaces history pulls 3 s apart, so the groups' poll times stay staggered by themselves.
  const pollDue = (lastPolledAt: string | null): boolean => lastPolledAt === null || now().getTime() - Date.parse(lastPolledAt) >= d.config.pollMinutes * 60_000;

  const pollOne = async (reader: PublicReader, username: string): Promise<void> => {
    const g = d.store.group(username);
    if (!g || g.access === "join_required" || g.access === "pending" || g.access === "refused") return;
    let peer = peerOf(g);
    if (!peer) {
      const found = await d.queue.run("resolve", () => reader.resolve(username));
      if (!found) {
        d.store.setGroup(username, { access: "refused", parkReason: "no public group or channel has this username", lastPolledAt: now().toISOString() });
        return;
      }
      peer = found;
      d.store.setGroup(username, { peerId: found.peerId, title: found.title });
    }
    const target = peer;
    const read = await d.queue.run("history", () => reader.history(target, { minId: g.lastMessageId, limit: PULL_LIMIT }));
    if (!read.ok) {
      d.store.setGroup(username, { access: read.reason === "join_required" ? "join_required" : "refused", parkReason: read.reason === "private" ? "the group is private" : null, lastPolledAt: now().toISOString() });
      d.onWritten?.();
      return;
    }
    const stored = d.store.addMessages(username, read.messages.filter((m: PublicMessage) => m.text.trim() !== "").map((m) => ({ messageId: m.id, senderId: m.senderId, senderHandle: m.senderHandle, text: m.text, sentAt: m.sentAt })), now());
    d.store.setGroup(username, { access: g.access === "joined" ? "joined" : "open", lastPolledAt: now().toISOString(), parkReason: null });
    if (stored > 0) d.onWritten?.();
  };

  const analyseDue = async () => {
    for (const g of d.store.groups()) {
      if (!d.config.groups.includes(g.username) || !analysisDue(g, now())) continue;
      try {
        const a = await analyseGroup({ llm: d.llm, store: d.store, lens: d.lens, now }, g.username);
        d.onAnalysed?.(g.username, a);
        if (a.windows > 0) d.onWritten?.();
        // Counts only: never a text, a handle or a quote.
        log.info("window analysis", { project: d.project, windows: a.windows, failed: a.failedWindows, moments: a.moments, costMicroUsd: a.costMicroUsd, ...(a.stopped ? { stopped: a.stopped } : {}) });
        if (a.stopped) return;
      } catch (e) {
        log.error("the window analysis failed", { project: d.project, ...errFields(e) });
        return;
      }
    }
  };

  const tick = async (): Promise<void> => {
    if (running || !d.config.on) return;
    running = true;
    try {
      const today = now().toISOString().slice(0, 10);
      if (lastRetention !== today) {
        lastRetention = today;
        const r = d.store.retention(now());
        if (r.messages || r.blanked) log.info("watch retention", { project: d.project, ...r });
      }
      const reader = d.reader();
      if (reader && d.queue.parkedUntil() === null) {
        const groups = d.store.groups().filter((g) => d.config.groups.includes(g.username));
        for (const g of groups) {
          if (!pollDue(g.lastPolledAt)) continue;
          try {
            await pollOne(reader, g.username);
          } catch (e) {
            if (e instanceof WatchParked || e instanceof FloodWaitError) {
              log.warn("the watcher is parked: Telegram asked the account to wait", { project: d.project, until: d.queue.parkedUntil() });
              break;
            }
            if (e instanceof WatchBudgetSpent) continue;
            log.warn("a public group could not be read", { project: d.project, ...errFields(e) });
          }
        }
      }
      await analyseDue();
    } finally {
      running = false;
    }
  };

  return {
    project: d.project,
    tick: () => tick().catch((e: unknown) => log.error("the watcher's tick failed", { project: d.project, ...errFields(e) })),
    async join(username) {
      const reader = d.reader();
      const g = d.store.group(username);
      if (!g || !d.config.groups.includes(username)) return { ok: false, reason: "This group is not on the watch list." };
      if (!reader) return { ok: false, reason: "No Telegram account is connected for this watch list." };
      const peer = peerOf(g);
      if (!peer) return { ok: false, reason: "The group has not been resolved yet; it is read on the next poll." };
      try {
        const access = await d.queue.run("join", () => reader.join(peer));
        d.store.setGroup(username, { access, parkReason: null, lastPolledAt: null });
        d.onWritten?.();
        return { ok: true, access };
      } catch (e) {
        return { ok: false, reason: e instanceof WatchBudgetSpent || e instanceof WatchParked || e instanceof FloodWaitError ? e.message : "Telegram did not accept the join." };
      }
    },
    state() {
      if (!d.config.on) return { state: "off" };
      const until = d.queue.parkedUntil();
      if (until) return { state: "parked", until, why: "Telegram asked the account to wait (FLOOD_WAIT); the watcher waits an hour more." };
      return d.reader() ? { state: "polling" } : { state: "no_account" };
    },
    start() {
      if (timer || !d.config.on) return;
      timer = setInterval(() => void this.tick(), TICK_MS);
      timer.unref();
      void this.tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
