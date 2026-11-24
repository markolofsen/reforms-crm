"use client";

import { useEffect } from "react";
import { load, save, useStored } from "@/lib/storage";
import { nextVisit, parseSeen } from "./groups";

/** The projects whose visit this tab has started: a reload or a new tab is a new visit. */
const started = new Set<string>();

/**
 * P138 verdict 6: the line of the "new since last visit" dot, the newest lead the previous visit saw (null on a first visit, so
 * no dot). Stored per viewer (`lib/storage.ts`, a viewing convenience); read through `useStored`, so the first render has none.
 */
export function useLeadsSeen(project: string, newest: string | null): string | null {
  const stored = useStored("leads-seen");
  useEffect(() => {
    if (newest === null) return;
    const map = parseSeen(load("leads-seen"));
    const fresh = !started.has(project);
    started.add(project);
    const next = nextVisit(map[project], newest, fresh);
    const old = map[project];
    if (old && old.prev === next.prev && old.last === next.last) return;
    save("leads-seen", JSON.stringify({ ...map, [project]: next }));
  }, [project, newest]);
  return parseSeen(stored)[project]?.prev ?? null;
}
