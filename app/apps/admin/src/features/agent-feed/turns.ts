import type { AgentFeedDto, FeedTone, FeedTurnDto } from "@hub/contract/agent-feed";

// The agent feed's pure parts (P59), tested in `test/agent-feed.test.ts`: which turns are new since the page read the feed,
// the one tone a batch earns, and which turn the strip's dot is about.

const RANK: Record<FeedTone, number> = { ready: 1, attention: 2, problem: 3 };

/** The highest tone of some turns (problem, then attention, then ready), or null for none. */
export function highestTone(turns: readonly FeedTurnDto[]): FeedTone | null {
  let best: FeedTone | null = null;
  for (const t of turns) if (!best || RANK[t.tone] > RANK[best]) best = t.tone;
  return best;
}

/**
 * The turns a reply adds to those this page already knows (`known`, mutated). The first reply of a project only fills
 * `known`: a turn that ended before the page loaded never sounds.
 */
export function newTurns(known: Set<string> | null, turns: readonly FeedTurnDto[]): { known: Set<string>; fresh: FeedTurnDto[] } {
  if (!known) return { known: new Set(turns.map((t) => t.id)), fresh: [] };
  const fresh = turns.filter((t) => !known.has(t.id));
  for (const t of fresh) known.add(t.id);
  return { known, fresh };
}

/** The turn the agent waits on, when it waits: the newest attention turn. Its id is what "seen" acknowledges. */
export function waitingTurn(feed: AgentFeedDto | undefined): string | null {
  if (!feed?.waiting) return null;
  return [...feed.turns].reverse().find((t) => t.tone === "attention")?.id ?? "waiting";
}
