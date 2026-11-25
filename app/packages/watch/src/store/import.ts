import { openSqliteReadOnly } from "@hub/db";
import { z } from "zod";
import type { NewMessage, NewMoment, NewWindow, WatchStore } from "./repo";

/**
 * `hub watch import <audience.sqlite> --project <slug>` (P144 W3): the experiment's corpus (Telethon, Python) into a project's
 * watch store, so the analysis and the page can be built and measured with no Telegram account. Reads the experiment's tables
 * `chats`, `messages`, `windows` and `moments` (one window size and overlap, 100 and 20 by default); only groups with a public
 * username come across. Idempotent: a known message, window or moment is skipped. The experiment's file is opened read-only.
 */

const Chat = z.object({ chat_id: z.number(), username: z.string().nullable(), title: z.string().nullable() });
const Message = z.object({ chat_id: z.number(), msg_id: z.number(), sender_id: z.number().nullable(), sender_username: z.string().nullable(), date: z.string(), text: z.string().nullable() });
const Window = z.object({ window_key: z.string(), chat_id: z.number(), first_msg: z.number(), last_msg: z.number(), n_messages: z.number(), cost_usd: z.number().nullable(), topics: z.string().nullable(), mood: z.string().nullable() });
const Moment = z.object({
  chat_id: z.number(),
  msg_id: z.number(),
  trigger: z.string(),
  trigger_other: z.string().nullable(),
  sender_id: z.number().nullable(),
  sender_username: z.string().nullable(),
  reactors: z.string().nullable(),
  quote: z.string().nullable(),
  thread_context: z.string().nullable(),
  intensity: z.number(),
  fit_reason: z.string().nullable(),
  window_key: z.string(),
});

const iso = (d: string): string => {
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : d;
};
const handle = (u: string | null): string | null => (u ? `@${u}` : null);
const list = (s: string | null): string[] => {
  try {
    const v: unknown = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export interface ImportResult {
  groups: number;
  messages: number;
  windows: number;
  moments: number;
}

export function importExperiment(file: string, store: WatchStore, o: { size?: number; overlap?: number; taskVersion: number; now?: Date }): ImportResult {
  const now = o.now ?? new Date();
  const size = o.size ?? 100;
  const overlap = o.overlap ?? 20;
  const src = openSqliteReadOnly(file);
  try {
    const c = src.client;
    const chats = c.prepare("SELECT chat_id, username, title FROM chats WHERE username IS NOT NULL AND username != ''").all().map((r) => Chat.parse(r));
    const byChat = new Map(chats.map((ch) => [ch.chat_id, (ch.username ?? "").toLowerCase()]));
    store.ensureGroups([...byChat.values()], now);
    for (const ch of chats) if (ch.title) store.setGroup((ch.username ?? "").toLowerCase(), { title: ch.title, access: "open" });
    const at = new Map<string, string>();
    let messages = 0;
    for (const ch of chats) {
      const username = byChat.get(ch.chat_id);
      if (!username) continue;
      const rows = c.prepare("SELECT chat_id, msg_id, sender_id, sender_username, date, text FROM messages WHERE chat_id = ? ORDER BY date, msg_id").all(ch.chat_id).map((r) => Message.parse(r));
      const batch: NewMessage[] = rows.filter((r) => (r.text ?? "").trim() !== "").map((r) => ({ messageId: r.msg_id, senderId: r.sender_id === null ? null : String(r.sender_id), senderHandle: handle(r.sender_username), text: r.text ?? "", sentAt: iso(r.date) }));
      for (const r of rows) at.set(`${r.chat_id}:${r.msg_id}`, iso(r.date));
      messages += store.addMessages(username, batch, now);
      // The imported corpus was already analysed by the experiment: nothing waits for the next analysis.
      store.setGroup(username, { newSinceAnalysis: 0, lastAnalysisAt: now.toISOString() });
    }
    const momentsOf = new Map<string, NewMoment[]>();
    for (const raw of c.prepare("SELECT * FROM moments WHERE size = ? AND overlap = ?").all(size, overlap)) {
      const m = Moment.parse(raw);
      const username = byChat.get(m.chat_id);
      if (!username) continue;
      const row: NewMoment = {
        groupUsername: username,
        messageId: m.msg_id,
        trigger: m.trigger,
        triggerOther: m.trigger_other ?? "",
        intensity: m.intensity,
        quote: m.quote ?? "",
        authorId: m.sender_id === null ? null : String(m.sender_id),
        authorHandle: handle(m.sender_username),
        reactorHandles: list(m.reactors),
        context: m.thread_context ?? "",
        why: m.fit_reason ?? "",
        windowKey: m.window_key,
        at: at.get(`${m.chat_id}:${m.msg_id}`) ?? now.toISOString(),
      };
      momentsOf.set(m.window_key, [...(momentsOf.get(m.window_key) ?? []), row]);
    }
    let windows = 0;
    let moments = 0;
    for (const raw of c.prepare("SELECT window_key, chat_id, first_msg, last_msg, n_messages, cost_usd, topics, mood FROM windows WHERE size = ? AND overlap = ?").all(size, overlap)) {
      const w = Window.parse(raw);
      const username = byChat.get(w.chat_id);
      if (!username || store.hasWindow(w.window_key)) continue;
      const win: NewWindow = {
        windowKey: w.window_key,
        groupUsername: username,
        firstMessageId: w.first_msg,
        lastMessageId: w.last_msg,
        messages: w.n_messages,
        taskVersion: o.taskVersion,
        model: "openai/gpt-4o-mini",
        costMicroUsd: Math.round((w.cost_usd ?? 0) * 1e6),
        topics: list(w.topics),
        mood: w.mood,
        firstAt: at.get(`${w.chat_id}:${w.first_msg}`) ?? now.toISOString(),
        lastAt: at.get(`${w.chat_id}:${w.last_msg}`) ?? now.toISOString(),
      };
      windows += 1;
      moments += store.recordWindow(win, momentsOf.get(w.window_key) ?? [], now);
    }
    return { groups: byChat.size, messages, windows, moments };
  } finally {
    src.close();
  }
}
