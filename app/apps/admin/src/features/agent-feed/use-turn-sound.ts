"use client";

import { useEffect, useRef } from "react";
import { useSound } from "@hub/ui/sound";
import { setSoundHolder } from "@/lib/cache/live";
import { useStored } from "@/lib/storage";
import type { AgentFeed } from "./use-agent-feed";
import { highestTone, newTurns } from "./turns";

/**
 * One tone per turn that ended since the page read the feed (P59 verdict 8): the highest of a reply's new turns, through
 * `useSound` (its debounce collapses a burst and keeps 4 s between tones). The first reply of a project is silent. Muted
 * when the stored switch says "off" (`sound-toggle.tsx`). The tab that plays tells the live stream to refetch the feed while hidden.
 */
export function useTurnSound(feed: AgentFeed): void {
  const muted = useStored("sound") === "off";
  const { play, holder } = useSound({ muted });
  const known = useRef<{ project: string | null; ids: Set<string> | null }>({ project: null, ids: null });
  useEffect(() => {
    setSoundHolder(holder);
    return () => setSoundHolder(false);
  }, [holder]);
  useEffect(() => {
    if (!feed.data) return;
    if (known.current.project !== feed.project) known.current = { project: feed.project, ids: null };
    const r = newTurns(known.current.ids, feed.data.turns);
    known.current.ids = r.known;
    const tone = highestTone(r.fresh);
    if (tone) play(tone);
  }, [feed.data, feed.project, play]);
}
