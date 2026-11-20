"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useReducer, useRef } from "react";
import type { LivePointer, PointerOutcome } from "@hub/contract/pointer";
import { Spotlight } from "@hub/ui/product/spotlight";
import { useRoute } from "@/hooks/use-route";
import { pointerApi } from "@/lib/api/terminal";
import { keys } from "@/lib/cache/keys";
import { useClock } from "@/lib/clock";
import { shareAway, sharePointerOutcome } from "@/lib/focus";

/** Pointers that are over (dismissed, expired, or shown and left behind by a route change): never drawn again in this tab. */
const ended = new Set<string>();

/**
 * The agent's pointer on the owner's screen (P72, decision 0038). On the live topic `pointer` the admin reads `GET /api/pointer`;
 * a pointer of this project, live and not over, is drawn by `@hub/ui/product/spotlight` inside `#main`. Its refs that are not on
 * this screen go to the dock header ("Agent points at … · Show", `features/terminal/agent-points.tsx`); only his click goes there, and
 * the ring is drawn again on the screen he opens. A drawn pointer ends on Escape, a click, a route change or after 30 s. Each
 * outcome goes back to the agent in the next focus post. Nothing else on the page changes.
 */
export function PointerLayer({ project }: { project: string | null }) {
  const route = useRoute();
  const clock = useClock();
  const q = useQuery({ queryKey: keys.pointer(), queryFn: pointerApi.get });
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const p = q.data?.pointer ?? null;
  const live: LivePointer | null = p && project && p.project === project && !ended.has(p.id) ? p : null;
  const screen = `${route.route} ${route.project ?? ""}`;
  const shownOn = useRef<{ id: string; screen: string } | null>(null);

  const finish = (id: string, outcome: PointerOutcome) => {
    ended.add(id);
    shownOn.current = null;
    sharePointerOutcome({ id, outcome });
    shareAway(null);
    rerender();
  };

  // A ring he saw goes with the screen it was on.
  useEffect(() => {
    const s = shownOn.current;
    if (s && s.screen !== screen) finish(s.id, "dismissed");
  }, [screen]);

  // A pointer that is only in the dock (not on this screen) still ends after its 30 s.
  const id = live?.id ?? null;
  const ttl = live ? Date.parse(live.expiresAt) - clock() : 0;
  useEffect(() => {
    if (!id) return;
    const t = window.setTimeout(() => {
      if (!ended.has(id)) finish(id, "expired");
    }, Math.max(0, ttl));
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!p) shareAway(null);
  }, [p]);

  if (!live) return null;
  const onOutcome = (outcome: PointerOutcome, missing: readonly string[]) => {
    if (outcome === "dismissed" || outcome === "expired") return finish(live.id, outcome);
    if (outcome === "shown") shownOn.current = { id: live.id, screen };
    sharePointerOutcome({ id: live.id, outcome });
    shareAway(missing.length ? { ...live, targets: live.targets.filter((t) => missing.includes(t.ref)) } : null);
  };
  return <Spotlight key={`${live.id} ${screen}`} note={live.note} onOutcome={onOutcome} refs={live.targets.map((t) => t.ref)} ttlMs={ttl} />;
}
