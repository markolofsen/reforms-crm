import { z } from "zod";

// The agent activity feed (P59): the last few things the agent did in one project, read from the tail of the session
// log (P54) on the server. Every label is computed there (`@hub/log/feed`); the reply carries no prompt, answer, command,
// query, address, subject, path or tool input or output: `label` is its one text field, and every object is strict.

export const FEED_STATES = ["running", "done", "failed", "refused"] as const;
export const FEED_TONES = ["attention", "ready", "problem"] as const;
export type FeedTone = (typeof FEED_TONES)[number];

/** A position in the log, `<day>:<byte offset>`: append order, which is not time order (Codex writes a turn's calls at its end). */
const position = z.string().regex(/^\d{4}-\d{2}-\d{2}:\d{12}$/);

export const feedRowDto = z.strictObject({
  id: position,
  at: z.string(),
  cli: z.enum(["claude", "codex"]),
  /** The CLI's session id, first 8 characters. */
  session: z.string().max(8),
  label: z.string().min(1).max(120),
  state: z.enum(FEED_STATES),
  /** The hub draft the row names: the row links to its card. */
  draft: z.number().int().positive().nullable(),
});
export type FeedRowDto = z.infer<typeof feedRowDto>;

/** A turn that ended, and the one tone it earns (verdict 8: problem, then attention, then ready). Its id is stable: a turn sounds once. */
export const feedTurnDto = z.strictObject({ id: z.string().min(1).max(240), tone: z.enum(FEED_TONES) });
export type FeedTurnDto = z.infer<typeof feedTurnDto>;

export const agentFeedDto = z.strictObject({
  rows: z.array(feedRowDto).max(5),
  turns: z.array(feedTurnDto).max(10),
  /** The position of the newest event read; empty when the log has none. */
  cursor: z.union([position, z.literal("")]),
  /** The agent waits on the owner: a session's latest event asks for him, under an hour ago, and nothing came after it. */
  waiting: z.boolean(),
});
export type AgentFeedDto = z.infer<typeof agentFeedDto>;
