"use client";

import { useAgentFeed as useAgentFeedQuery } from "@/lib/data/project";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { AgentFeedDto } from "@hub/contract/agent-feed";
import { waitingTurn } from "./turns";

// The agent activity feed (P59): one query per project, invalidated by the live topic `agent-log` (the server watches the
// session log). The shell frame makes one model and shares it: the strip's dot, the phone's button, the sound and its
// switch read it (P73: the sidebar shows no feed rows). Nothing here asks the agent anything (`admin-principles.md` rule 1).

export type AgentFeed = {
  project: string | null;
  data: AgentFeedDto | undefined;
  /** The agent waits on the owner and he has not opened the terminal since: the strip's dot takes the attention colour. */
  attention: boolean;
  /** He opened the terminal: the wait is seen until the next one. */
  seen: () => void;
};

export function useAgentFeed(project: string | null): AgentFeed {
  const q = useAgentFeedQuery(project);
  const [seenTurn, setSeenTurn] = useState<string | null>(null);
  const waiting = waitingTurn(q.data);
  const seen = useCallback(() => setSeenTurn(waiting), [waiting]);
  const { data } = q;
  return useMemo(() => ({ project, data, attention: waiting !== null && waiting !== seenTurn, seen }), [project, data, waiting, seenTurn, seen]);
}

export const AgentFeedContext = createContext<AgentFeed | null>(null);

/** The shared model; null outside the shell (nothing renders then). */
export const useFeed = (): AgentFeed | null => useContext(AgentFeedContext);
