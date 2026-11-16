"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { formatDest, type Dest } from "@/routes/paths";
import { routeOf } from "@/routes/typed";
import { useProject } from "./use-route";

/** Moves to a destination, carrying the current project. `replace` for a filter (not a page), the default push for a subject. */
export function useGo(): (d: Dest, options?: { replace?: boolean; project?: string }) => void {
  const router = useRouter();
  const project = useProject();
  return useCallback(
    (d, options = {}) => {
      const to = routeOf(formatDest(d, options.project ?? project));
      if (!to) return;
      if (options.replace) router.replace(to);
      else router.push(to);
    },
    [router, project],
  );
}
