"use client";

import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { WatchView } from "./watch-view";

/** The Watch screen (P144, `/watch`, `g w`): what the public groups a project watches talk about, read from its watch store. */
export function WatchScreen() {
  const { project } = useProjectScope();
  const route = useRoute("watch.page");
  if (!route) return null;
  return <WatchView project={project} q={route.search} />;
}
