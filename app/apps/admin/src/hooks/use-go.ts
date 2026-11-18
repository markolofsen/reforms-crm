"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { formatDest, type Dest } from "@/routes/paths";
import { routeOf } from "@/routes/typed";
import { usePlace } from "./use-project";

/** Moves to a destination, in the current place (or another project of it). `replace` for a filter (not a page), the default push for a subject. */
export function useGo(): (d: Dest, options?: { replace?: boolean; project?: string }) => void {
  const router = useRouter();
  const place = usePlace();
  return useCallback(
    (d, options = {}) => {
      const to = routeOf(formatDest(d, options.project ? { ...place, project: options.project } : place));
      if (!to) return;
      if (options.replace) router.replace(to);
      else router.push(to);
    },
    [router, place],
  );
}
