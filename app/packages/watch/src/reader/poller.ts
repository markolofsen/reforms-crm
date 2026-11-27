import type { Llm } from "@hub/llm";
import { errFields, ops } from "@hub/log/ops";
import { analyseGroup, analysisDue, type GroupAnalysis } from "../analyse/job";
import { watchGroups, type WatchConfig } from "../config";
import type { LoadedLens } from "../lens/load";
import type { WatchStore } from "../store/repo";
import { WatchBudgetSpent, WatchParked, type WatchQueue } from "./queue";
import { FloodWaitError, PeerUnknownError, type PublicMessage, type PublicPeer, type PublicReader } from "./types";
import type { WatchPolicyRead } from "../policy";
import { membershipTick, observeMembership, ownerJoin } from "./membership";

/**
 * One project's watcher (P144 W4 and W5): a tick polls each group whose time has come (every `poll_minutes`; the queue's 3-second gap
 * keeps the groups staggered), stores what is new, and runs the window analysis of a group that is due. Every Telegram call
 * goes through the account's watch queue (`queue.ts`); the reader may be absent (no connected account), and then nothing is
 * read. Reading is without joining: a group that refuses its history until joined shows "must be joined" and waits for the
 * owner's Join. A watch list that is off polls nothing. The retention runs once a day.
 */

export { createWatchQueue, type WatchQueue, type JoinStatus } from "./queue";
export { FloodWaitError, PeerUnknownError, type OwnerActivity, type PublicMessage, type PublicPeer, type PublicReader } from "./types";

/** Messages per history pull. */
export const PULL_LIMIT = 100;
/** A tick of the watcher: frequent enough to keep 5-minute polls staggered, cheap when nothing is due. */
export const TICK_MS = 30_000;
/** Bounded oldest-due-first work even when a project opts into a larger source list. */
export const POLL_BATCH_LIMIT = 8;

export type WatcherState = { state: "off" } | { state: "no_account" } | { state: "parked"; until: string; why: string } | { state: "polling" };

export interface Watcher {
  readonly project: string;
  /** One pass now (the timer's, and tests'). Never throws. */
  tick(): Promise<void>;
  /** The owner's Join button for one group. */
  join(username: string): Promise<{ ok: true; access: "joined" | "pending" | "manual_required" } | { ok: false; reason: string }>;
  state(): WatcherState;
  start(): void;
  stop(): void;
  /**
   * P153: a changed watch.md or lens.json, already checked, taken while running: the list's groups are added, the switch starts
   * or stops the timer (`timers` false in tests), and the next analysis uses the new lens. Old windows stay as they were.
   */
  update(next: { config?: WatchConfig; lens?: LoadedLens }, o?: { timers?: boolean }): void;
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
  /** Loaded enabled analyses over the same fetched source rows. No second reader per direction. */
  analyses?: () => WatchAnalysis[];
  membership?: { account: () => string | null; policy: () => WatchPolicyRead };
}

export interface WatchAnalysis { direction: string; groups: string[]; lens: LoadedLens; store: WatchStore; analysisMinutes?: number }

const peerOf = (g: { peerId: string | null; title: string | null; accessHash: string | null }): PublicPeer | null => (g.peerId ? { peerId: g.peerId, title: g.title, accessHash: g.accessHash } : null);

/** A group whose read fails (not a FLOOD_WAIT) waits 5 min, then twice as long each time, at most 6 h; a good read clears it. */
export const BACKOFF_BASE_MS = 5 * 60_000;
export const BACKOFF_MAX_MS = 6 * 3_600_000;
export const backoffMs = (failures: number): number => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));

/** The username's peer from Telegram (one of the day's resolves), stored on the row; null when no public group has it. */
async function resolveInto(d: WatcherDeps, at: Date, reader: PublicReader, username: string, expectedPeerId?: string): Promise<PublicPeer | null> {
  const found = await d.queue.run("resolve", () => reader.resolve(username));
  d.store.addResolve(at.toISOString().slice(0, 10));
  if (found && expectedPeerId && found.peerId !== expectedPeerId) return null;
  if (!found) {
    d.store.setGroup(username, { access: "refused", parkReason: "no public group or channel has this username", lastPolledAt: at.toISOString() });
    return null;
  }
  d.store.setGroup(username, { peerId: found.peerId, title: found.title, accessHash: found.accessHash ?? null });
  const account = d.membership?.account();
  if (account) { observeMembership(d.store, account, username, found, at); d.onWritten?.(); }
  return found;
}

/** Any failure but a FLOOD_WAIT (a local client error included) backs the group off, said on its Groups row. */
function backOff(d: WatcherDeps, failures: Map<string, number>, username: string, e: unknown, at: Date): void {
  const n = (failures.get(username) ?? 0) + 1;
  failures.set(username, n);
  const until = new Date(at.getTime() + backoffMs(n)).toISOString();
  const why = (e instanceof Error ? e.message : String(e)).replace(/-?\d{6,}/g, "…").slice(0, 120);
  d.store.setGroup(username, { parkedUntil: until, parkReason: `could not be read (${why})` });
  d.onWritten?.();
  ops("watch").warn("a public group could not be read: it waits before the next try", { project: d.project, failures: n, until, ...errFields(e) });
}

export function createWatcher(d: WatcherDeps): Watcher {
  const now = d.now ?? (() => new Date());
  const log = ops("watch");
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let lastRetention = "";
  const analyses = (): WatchAnalysis[] => d.analyses?.() ?? [{ direction: "default", groups: d.config.groups, lens: d.lens, store: d.store, analysisMinutes: d.config.analysisMinutes ?? 360 }];
  const groupsToRead = (): string[] => [...new Set(analyses().flatMap((a) => a.groups))];
  d.store.ensureGroups(watchGroups(d.config), now());

  // The queue spaces history pulls 3 s apart, so the groups' poll times stay staggered by themselves.
  const pollDue = (lastPolledAt: string | null): boolean => lastPolledAt === null || now().getTime() - Date.parse(lastPolledAt) >= d.config.pollMinutes * 60_000;

  // Failures in a row per group (memory only; the wait itself is the row's `parkedUntil`, so a restart keeps it).
  const failures = new Map<string, number>();

  const resolvePeer = (reader: PublicReader, username: string, expectedPeerId?: string) => resolveInto(d, now(), reader, username, expectedPeerId);

  const pollOne = async (reader: PublicReader, username: string): Promise<void> => {
    const g = d.store.group(username);
    if (!g || g.access === "join_required" || g.access === "pending" || g.access === "refused") return;
    const peer = peerOf(g) ?? (await resolvePeer(reader, username));
    if (!peer) return;
    const pull = (p: PublicPeer) => d.queue.run("history", () => reader.history(p, { minId: g.lastMessageId, limit: PULL_LIMIT }));
    let read;
    try {
      read = await pull(peer);
    } catch (e) {
      // The stored peer outlived the client's peer cache (a restart): resolve the username once more and read again. A second
      // refusal is a failure of the group (backed off below), never a loop.
      if (!(e instanceof PeerUnknownError)) throw e;
      log.info("a stored group peer is unknown to the client: resolving its username again", { project: d.project });
      const again = await resolvePeer(reader, username);
      if (!again) return;
      read = await pull(again);
    }
    if (!read.ok) {
      d.store.setGroup(username, { access: read.reason === "join_required" ? "join_required" : "refused", parkReason: read.reason === "private" ? "the group is private" : null, lastPolledAt: now().toISOString() });
      d.onWritten?.();
      return;
    }
    const stored = d.store.addMessages(username, read.messages.filter((m: PublicMessage) => m.text.trim() !== "").map((m) => ({ messageId: m.id, senderId: m.senderId, senderHandle: m.senderHandle, text: m.text, sentAt: m.sentAt, replyToMessageId: m.replyToMessageId ?? null, threadId: m.threadId ?? null })), now());
    // Media-only pages still advance the fetched cursor after the store write succeeded.
    const lastMessageId = Math.max(g.lastMessageId, ...read.messages.map((m) => m.id));
    d.store.setGroup(username, { access: g.access === "joined" ? "joined" : "open", lastMessageId, lastPolledAt: now().toISOString(), parkReason: null });
    if (stored > 0) d.onWritten?.();
  };

  const analyseDue = async () => {
    for (const scope of analyses()) {
    for (const g of scope.store.analysisGroups()) {
      if (!scope.groups.includes(g.username) || !analysisDue(g, now(), (scope.analysisMinutes ?? 360) * 60_000)) continue;
      try {
        const a = await analyseGroup({ llm: d.llm, store: scope.store, lens: scope.lens, now }, g.username);
        d.onAnalysed?.(g.username, a);
        if (a.windows > 0) d.onWritten?.();
        // Counts only: never a text, a handle or a quote.
        log.info("window analysis", { project: d.project, direction: scope.direction, windows: a.windows, failed: a.failedWindows, moments: a.moments, scriptAuthors: a.scriptAuthors, costMicroUsd: a.costMicroUsd, ...(a.stopped ? { stopped: a.stopped } : {}) });
        if (a.stopped) break;
      } catch (e) {
        log.error("the window analysis failed", { project: d.project, direction: scope.direction, ...errFields(e) });
        break;
      }
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
        const listed = new Set(groupsToRead());
        const groups = d.store.groups().filter((g) => listed.has(g.username) && !["join_required", "pending", "refused"].includes(g.access) && pollDue(g.lastPolledAt) && (g.parkedUntil === null || Date.parse(g.parkedUntil) <= now().getTime()))
          .sort((a, b) => (a.lastPolledAt ?? "").localeCompare(b.lastPolledAt ?? "") || a.username.localeCompare(b.username)).slice(0, POLL_BATCH_LIMIT);
        for (const g of groups) {
          if (!pollDue(g.lastPolledAt)) continue;
          if (g.parkedUntil !== null && Date.parse(g.parkedUntil) > now().getTime()) continue;
          try {
            await pollOne(reader, g.username);
            if (failures.delete(g.username) || g.parkedUntil !== null) {
              d.store.setGroup(g.username, { parkedUntil: null });
              d.onWritten?.();
            }
          } catch (e) {
            if (e instanceof WatchParked || e instanceof FloodWaitError) {
              log.warn("the watcher is parked: Telegram asked the account to wait", { project: d.project, until: d.queue.parkedUntil() });
              break;
            }
            if (e instanceof WatchBudgetSpent) continue;
            backOff(d, failures, g.username, e, now());
          }
        }
      }
      if (d.membership) await membershipTick({ store: d.store, queue: d.queue, reader: d.reader, config: () => d.config,
        account: d.membership.account, policy: d.membership.policy, now, ...(d.onWritten ? { onWritten: d.onWritten } : {}) });
      await analyseDue();
    } finally {
      running = false;
    }
  };

  return {
    project: d.project,
    tick: () => tick().catch((e: unknown) => log.error("the watcher's tick failed", { project: d.project, ...errFields(e) })),
    join: (username) => ownerJoin(d, now, resolvePeer, username),
    state() {
      if (!d.config.on) return { state: "off" };
      const until = d.queue.parkedUntil();
      if (until) return { state: "parked", until, why: d.queue.parkReason() ?? "The account's Watch queue is parked." };
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
    update(next, o = {}) {
      if (next.lens) d.lens = next.lens;
      if (next.config) {
        d.config = next.config;
        d.store.ensureGroups(watchGroups(next.config), now());
        if (!next.config.on) this.stop();
        else if (o.timers !== false) this.start();
      }
    },
  };
}
