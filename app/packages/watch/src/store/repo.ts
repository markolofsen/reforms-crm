import { join, resolve } from "node:path";
import { openOwnFile, type SqliteClient } from "@hub/db";
import { GroupRow, MessageRow, parseRows, type GroupAccess, type WatchGroup, type WatchMessage } from "./rows";
import { createReads, type WatchReads } from "./read";

/**
 * The watch store of one project (P144 W3, verdict 12): its own file `data/watch/<slug>.db` through `@hub/db`'s `openOwnFile`,
 * with its own migrations (`packages/watch/migrations`). Only the server migrates an existing file (P141's guard); the doctor and
 * the import open a new one or a current one. Every query names the project.
 */

export { GROUP_ACCESS, type GroupAccess, type WatchGroup, type WatchMessage, type WatchMoment, type WatchWindow } from "./rows";
export type { WatchReads, TriggerStat, TopicStat, PersonStat, GroupStat, TrendDay, MomentFilter } from "./read";

const MIGRATIONS = resolve(import.meta.dirname, "..", "..", "migrations");

/** Retention (verdict 12). */
export const MESSAGE_DAYS = 30;
export const AUTHOR_DAYS = 180;

/** `<watch>/<slug>.db`. */
export const watchDbFile = (watchDir: string, slug: string): string => join(watchDir, `${slug}.db`);

export interface NewMessage {
  messageId: number;
  senderId: string | null;
  senderHandle: string | null;
  text: string;
  sentAt: string;
}

export interface NewWindow {
  windowKey: string;
  groupUsername: string;
  firstMessageId: number;
  lastMessageId: number;
  messages: number;
  taskVersion: number;
  model: string | null;
  costMicroUsd: number;
  topics: string[];
  mood: string | null;
  firstAt: string;
  lastAt: string;
}

export interface NewMoment {
  groupUsername: string;
  messageId: number;
  trigger: string;
  triggerOther: string;
  intensity: number;
  quote: string;
  authorId: string | null;
  authorHandle: string | null;
  reactorHandles: string[];
  context: string;
  why: string;
  windowKey: string;
  at: string;
}

export type GroupPatch = Partial<Pick<WatchGroup, "title" | "peerId" | "accessHash" | "access" | "lastMessageId" | "lastPolledAt" | "parkedUntil" | "parkReason" | "newSinceAnalysis" | "lastAnalysisAt">>;

const COLUMN: Record<keyof GroupPatch, string> = {
  title: "title",
  peerId: "peer_id",
  accessHash: "access_hash",
  access: "access",
  lastMessageId: "last_message_id",
  lastPolledAt: "last_polled_at",
  parkedUntil: "parked_until",
  parkReason: "park_reason",
  newSinceAnalysis: "new_since_analysis",
  lastAnalysisAt: "last_analysis_at",
};

export interface WatchStore extends WatchReads {
  readonly project: string;
  /** The watch list's groups, added once (removing a username from watch.md keeps its rows; it is simply not polled). */
  ensureGroups(usernames: readonly string[], now: Date): void;
  groups(): WatchGroup[];
  group(username: string): WatchGroup | null;
  setGroup(username: string, patch: GroupPatch): void;
  /** The username resolves this project's watcher made on a UTC day (P153 D4: the count outlives a restart). */
  resolvesOn(day: string): number;
  addResolve(day: string): void;
  /** Stores new messages (a known id is skipped), counts them per day and towards the next analysis; returns how many were new. */
  addMessages(username: string, messages: readonly NewMessage[], now: Date): number;
  /** The group's messages in time order, from `sinceIso` (the analysis reads what it has not read, with the overlap). */
  messagesOf(username: string, o?: { afterMessageId?: number; limit?: number }): WatchMessage[];
  hasWindow(windowKey: string): boolean;
  /** The highest message id an analysed window of the group reached (0 before the first). */
  windowsLastMessage(username: string): number;
  /** One analysed window and its kept moments, in one transaction; a moment already stored (same message and trigger) is skipped. */
  recordWindow(window: NewWindow, moments: readonly NewMoment[], now: Date): number;
  /** Deletes messages past 30 days and blanks moments' authors past 180 days. */
  retention(now: Date): { messages: number; blanked: number };
  close(): void;
}

const day = (iso: string): string => iso.slice(0, 10);

export function openWatchStore(file: string, o: { project: string; migrate?: boolean }): WatchStore {
  const h = openOwnFile(file, { migrationsFolder: MIGRATIONS, label: `watch:${o.project}`, ...(o.migrate ? { migrate: true } : {}) });
  return storeOn(h.client, o.project, h.close);
}

export function storeOn(c: SqliteClient, project: string, close: () => void = () => c.close()): WatchStore {
  const p = project;
  const reads = createReads(c, p);
  return {
    ...reads,
    project: p,
    ensureGroups(usernames, now) {
      const ins = c.prepare("INSERT INTO groups (project, username, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING");
      c.transaction(() => {
        for (const u of usernames) ins.run(p, u, now.toISOString());
      })();
    },
    groups: () => parseRows(GroupRow, c.prepare("SELECT * FROM groups WHERE project = ? ORDER BY added_at, username").all(p)),
    group(username) {
      const r: unknown = c.prepare("SELECT * FROM groups WHERE project = ? AND username = ?").get(p, username);
      return r === undefined ? null : GroupRow.parse(r);
    },
    setGroup(username, patch) {
      const keys = Object.keys(COLUMN).filter((k): k is keyof GroupPatch => k in patch);
      if (keys.length === 0) return;
      const values = keys.map((k) => patch[k] ?? null);
      c.prepare(`UPDATE groups SET ${keys.map((k) => `${COLUMN[k]} = ?`).join(", ")} WHERE project = ? AND username = ?`).run(...values, p, username);
    },
    resolvesOn(d) {
      const r: unknown = c.prepare("SELECT resolves FROM resolve_days WHERE project = ? AND day = ?").get(p, d);
      return typeof r === "object" && r !== null && typeof Reflect.get(r, "resolves") === "number" ? Number(Reflect.get(r, "resolves")) : 0;
    },
    addResolve(d) {
      c.prepare("INSERT INTO resolve_days (project, day, resolves) VALUES (?, ?, 1) ON CONFLICT (project, day) DO UPDATE SET resolves = resolves + 1").run(p, d);
    },
    addMessages(username, messages, now) {
      const ins = c.prepare("INSERT INTO messages (project, group_username, message_id, sender_id, sender_handle, text, sent_at, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING");
      const perDay = c.prepare("INSERT INTO group_days (project, group_username, day, messages) VALUES (?, ?, ?, 1) ON CONFLICT (project, group_username, day) DO UPDATE SET messages = messages + 1");
      return c.transaction(() => {
        let n = 0;
        let top = 0;
        for (const m of messages) {
          top = Math.max(top, m.messageId);
          if (ins.run(p, username, m.messageId, m.senderId, m.senderHandle, m.text, m.sentAt, now.toISOString()).changes === 0) continue;
          n += 1;
          perDay.run(p, username, day(m.sentAt));
        }
        c.prepare("UPDATE groups SET new_since_analysis = new_since_analysis + ?, last_message_id = max(last_message_id, ?) WHERE project = ? AND username = ?").run(n, top, p, username);
        return n;
      })();
    },
    messagesOf(username, q = {}) {
      return parseRows(
        MessageRow,
        c.prepare("SELECT * FROM messages WHERE project = ? AND group_username = ? AND message_id > ? ORDER BY sent_at, message_id LIMIT ?").all(p, username, q.afterMessageId ?? 0, q.limit ?? 100_000),
      );
    },
    windowsLastMessage(username) {
      const r: unknown = c.prepare("SELECT coalesce(max(last_message_id), 0) AS n FROM windows WHERE project = ? AND group_username = ?").get(p, username);
      return r && typeof r === "object" && "n" in r && typeof r.n === "number" ? r.n : 0;
    },
    hasWindow: (key) => c.prepare("SELECT 1 FROM windows WHERE project = ? AND window_key = ?").get(p, key) !== undefined,
    recordWindow(w, moments, now) {
      const insW = c.prepare("INSERT INTO windows (project, window_key, group_username, first_message_id, last_message_id, messages, task_version, model, cost_micro_usd, topics, mood, first_at, last_at, analysed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING");
      const insM = c.prepare("INSERT INTO moments (project, group_username, message_id, trigger, trigger_other, intensity, quote, author_id, author_handle, reactors, reactor_handles, context, why, window_key, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING");
      return c.transaction(() => {
        insW.run(p, w.windowKey, w.groupUsername, w.firstMessageId, w.lastMessageId, w.messages, w.taskVersion, w.model, Math.max(0, Math.round(w.costMicroUsd)), JSON.stringify(w.topics), w.mood, w.firstAt, w.lastAt, now.toISOString());
        let n = 0;
        for (const m of moments) {
          n += insM.run(p, m.groupUsername, m.messageId, m.trigger, m.triggerOther, Math.round(m.intensity), m.quote, m.authorId, m.authorHandle, m.reactorHandles.length, JSON.stringify(m.reactorHandles), m.context, m.why, m.windowKey, m.at).changes;
        }
        return n;
      })();
    },
    retention(now) {
      const msgCut = new Date(now.getTime() - MESSAGE_DAYS * 86_400_000).toISOString();
      const authorCut = new Date(now.getTime() - AUTHOR_DAYS * 86_400_000).toISOString();
      const messages = c.prepare("DELETE FROM messages WHERE project = ? AND sent_at < ?").run(p, msgCut).changes;
      const blanked = c.prepare("UPDATE moments SET author_id = NULL, author_handle = NULL, reactor_handles = '[]', blanked = 1 WHERE project = ? AND at < ? AND blanked = 0").run(p, authorCut).changes;
      return { messages, blanked };
    },
    close,
  };
}

/** The access words a group's row shows (the Groups view). */
export const ACCESS_WORDS: Record<GroupAccess, string> = {
  unknown: "not read yet",
  open: "read without joining",
  join_required: "this group must be joined to be read",
  pending: "join request waiting for the group's admin",
  joined: "joined, read",
  refused: "Telegram refused to show it",
};
