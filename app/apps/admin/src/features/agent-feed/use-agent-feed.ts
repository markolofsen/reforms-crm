"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { AgentFeedDto } from "@hub/contract/agent-feed";
import { ApiFailure } from "@/lib/api/client";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { waitingTurn } from "./turns";

// The agent activity feed (P59): one query per project, invalidated by the live topic `agent-log` (the server watches the
// session log). The shell frame makes one model and shares it: the sidebar's block, the strip's dot, the phone's button
// and the sound read it. Nothing here asks the agent anything (`admin-principles.md` rule 1).

export type AgentFeed = {
  project: string | null;
  data: AgentFeedDto | undefined;
  /** The feed failed for another reason than an older server (404): the block says so, with Retry. */
  failed: boolean;
  retry: () => void;
  retrying: boolean;
  /** The agent waits on the owner and he has not opened the terminal since: the strip's dot takes the attention colour. */
  attention: boolean;
  /** He opened the terminal: the wait is seen until the next one. */
  seen: () => void;
};

export function useAgentFeed(project: string | null): AgentFeed {
  const q = useQuery({ queryKey: keys.agentFeed(project ?? ""), queryFn: () => metaApi.agentFeed(project ?? ""), enabled: project !== null });
  const [seenTurn, setSeenTurn] = useState<string | null>(null);
  const waiting = waitingTurn(q.data);
  const seen = useCallback(() => setSeenTurn(waiting), [waiting]);
  const failed = q.isError && !(q.error instanceof ApiFailure && q.error.status === 404);
  const { refetch, isFetching, data } = q;
  return useMemo(
    () => ({ project, data, failed, retry: () => void refetch(), retrying: isFetching, attention: waiting !== null && waiting !== seenTurn, seen }),
    [project, data, failed, refetch, isFetching, waiting, seenTurn, seen],
  );
}

export const AgentFeedContext = createContext<AgentFeed | null>(null);

/** The shared model; null outside the shell (nothing renders then). */
export const useFeed = (): AgentFeed | null => useContext(AgentFeedContext);
