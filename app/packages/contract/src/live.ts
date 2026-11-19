import { z } from "zod";

// Live panels (P50, decision 0028, `@docs/core/06-local-admin-app.md`). `GET /api/live` is a same-origin SSE stream of
// tiny invalidation events: it names what changed (a topic and a project), never the data, and the admin refetches
// through the normal API. Every object is strict: an unknown type or field is refused, and the admin then refreshes all.

/**
 * What can move. Each table maps to one topic on the server; `connections`, `health` and `mail` are bumped, not tables.
 * `mail` (P53): the hub wrote a Mail draft of this project (`draft_write`), so the admin reads the open draft from Mail again.
 * `agent-log` (P59): a day file of the project's agent session log grew (the server watches `state/log`), so the feed refetches.
 */
export const LIVE_TOPICS = ["drafts", "clients", "activity", "sends", "inbox", "follow-ups", "batches", "rules", "projects", "knowledge", "messengers", "connections", "health", "mail", "agent-log"] as const;
export const liveTopic = z.enum(LIVE_TOPICS);
export type LiveTopic = (typeof LIVE_TOPICS)[number];

const seq = z.number().int().nonnegative();
/** `null`: the whole instance (Connections, health). */
const project = z.string().min(1).max(100).nullable();

export const liveChange = z.strictObject({ topic: liveTopic, project });
export type LiveChangeDto = z.infer<typeof liveChange>;

/** Every frame is an unnamed SSE event (the page's `onmessage`) whose `data:` is one `liveEvent`. */
export const liveEvent = z.discriminatedUnion("type", [
  /** First frame of every connection: the counter now and the server's API version. */
  z.strictObject({ type: z.literal("hello"), seq, apiVersion: z.number().int() }),
  /** Something moved; `seq` is also the frame's SSE `id`, so a reconnect resumes after it. */
  z.strictObject({ type: z.literal("change"), seq, changes: z.array(liveChange).min(1) }),
  /** The server cannot say what moved (a resume point it does not know, a client too slow to keep up): refetch everything. */
  z.strictObject({ type: z.literal("reset"), seq }),
]);
export type LiveEvent = z.infer<typeof liveEvent>;

/** One frame's `data:` text, or null when it is not a frame this page knows. */
export function parseLiveEvent(text: string): LiveEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = liveEvent.safeParse(raw);
  return r.success ? r.data : null;
}

/** At most this many streams at once: one per browser is the design (a leader tab), so 16 is a lot of browsers. */
export const MAX_LIVE_SUBSCRIBERS = 16;
