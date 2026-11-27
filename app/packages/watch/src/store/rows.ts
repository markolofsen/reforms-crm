import { z } from "zod";

/** The rows of the watch database (`migrations/0001_watch.sql`), parsed at the one place SQLite hands them back. */

export const GROUP_ACCESS = ["unknown", "open", "join_required", "pending", "joined", "refused"] as const;
export type GroupAccess = (typeof GROUP_ACCESS)[number];

const json = <T extends z.ZodType>(inner: T) =>
  z.string().transform((s, ctx) => {
    try {
      return inner.parse(JSON.parse(s));
    } catch {
      ctx.addIssue({ code: "custom", message: "not the stored JSON" });
      return z.NEVER;
    }
  });

export const GroupRow = z
  .object({
    username: z.string(),
    title: z.string().nullable(),
    peer_id: z.string().nullable(),
    access_hash: z.string().nullable(),
    access: z.enum(GROUP_ACCESS),
    last_message_id: z.number().int(),
    last_polled_at: z.string().nullable(),
    parked_until: z.string().nullable(),
    park_reason: z.string().nullable(),
    new_since_analysis: z.number().int(),
    last_analysis_at: z.string().nullable(),
    added_at: z.string(),
  })
  .transform((r) => ({
    username: r.username,
    title: r.title,
    peerId: r.peer_id,
    accessHash: r.access_hash,
    access: r.access,
    lastMessageId: r.last_message_id,
    lastPolledAt: r.last_polled_at,
    parkedUntil: r.parked_until,
    parkReason: r.park_reason,
    newSinceAnalysis: r.new_since_analysis,
    lastAnalysisAt: r.last_analysis_at,
    addedAt: r.added_at,
  }));
export type WatchGroup = z.output<typeof GroupRow>;

export const MessageRow = z
  .object({ group_username: z.string(), message_id: z.number().int(), sender_id: z.string().nullable(), sender_handle: z.string().nullable(), text: z.string(), sent_at: z.string(), reply_to_message_id: z.number().int().nullable().optional(), thread_id: z.number().int().nullable().optional() })
  .transform((r) => ({ groupUsername: r.group_username, messageId: r.message_id, senderId: r.sender_id, senderHandle: r.sender_handle, text: r.text, sentAt: r.sent_at, replyToMessageId: r.reply_to_message_id ?? null, threadId: r.thread_id ?? null }));
export type WatchMessage = z.output<typeof MessageRow>;

export const MomentRow = z
  .object({
    group_username: z.string(),
    message_id: z.number().int(),
    trigger: z.string(),
    trigger_other: z.string(),
    intensity: z.number().int(),
    quote: z.string(),
    author_id: z.string().nullable(),
    author_handle: z.string().nullable(),
    reactors: z.number().int(),
    reactor_handles: json(z.array(z.string())),
    context: z.string(),
    why: z.string(),
    window_key: z.string(),
    at: z.string(),
  })
  .transform((r) => ({
    groupUsername: r.group_username,
    messageId: r.message_id,
    trigger: r.trigger,
    triggerOther: r.trigger_other,
    intensity: r.intensity,
    quote: r.quote,
    authorId: r.author_id,
    authorHandle: r.author_handle,
    reactors: r.reactors,
    reactorHandles: r.reactor_handles,
    context: r.context,
    why: r.why,
    windowKey: r.window_key,
    at: r.at,
  }));
export type WatchMoment = z.output<typeof MomentRow>;

export const WindowRow = z
  .object({
    window_key: z.string(),
    group_username: z.string(),
    first_message_id: z.number().int(),
    last_message_id: z.number().int(),
    messages: z.number().int(),
    task_version: z.number().int(),
    model: z.string().nullable(),
    cost_micro_usd: z.number().int(),
    topics: json(z.array(z.string())),
    mood: z.string().nullable(),
    first_at: z.string(),
    last_at: z.string(),
    analysed_at: z.string(),
  })
  .transform((r) => ({
    windowKey: r.window_key,
    groupUsername: r.group_username,
    firstMessageId: r.first_message_id,
    lastMessageId: r.last_message_id,
    messages: r.messages,
    taskVersion: r.task_version,
    model: r.model,
    costMicroUsd: r.cost_micro_usd,
    topics: r.topics,
    mood: r.mood,
    firstAt: r.first_at,
    lastAt: r.last_at,
    analysedAt: r.analysed_at,
  }));
export type WatchWindow = z.output<typeof WindowRow>;

/** Rows of one parsed kind; a row that does not parse is a schema the code does not expect, so it throws. */
export const parseRows = <T extends z.ZodType>(schema: T, rows: unknown[]): Array<z.output<T>> => rows.map((r) => schema.parse(r));
