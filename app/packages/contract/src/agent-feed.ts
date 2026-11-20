import { z } from "zod";

// The agent activity feed (P59): whether the agent waits on the owner and the tone of each turn that ended in one project,
// read from the tail of the session log (P54) on the server (`@hub/log/feed`). It drives the strip's dot, the phone
// button's dot and the tones; since P73 (decision 0037) the sidebar shows no feed rows, so the reply carries no label, no
// prompt, answer, command, query, address, subject, path or tool input or output. Every object is strict.

export const FEED_TONES = ["attention", "ready", "problem"] as const;
export type FeedTone = (typeof FEED_TONES)[number];

/** A turn that ended, and the one tone it earns (verdict 8: problem, then attention, then ready). Its id is stable: a turn sounds once. */
export const feedTurnDto = z.strictObject({ id: z.string().min(1).max(240), tone: z.enum(FEED_TONES) });
export type FeedTurnDto = z.infer<typeof feedTurnDto>;

export const agentFeedDto = z.strictObject({
  turns: z.array(feedTurnDto).max(10),
  /** The agent waits on the owner: a session's latest event asks for him, under an hour ago, and nothing came after it. */
  waiting: z.boolean(),
});
export type AgentFeedDto = z.infer<typeof agentFeedDto>;
