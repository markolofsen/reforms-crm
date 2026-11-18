"use client";

import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { ActivityPage } from "./activity-page";

/** The Activity screen: what the agent did in this project. The view and the opened session are read from the address. */
export function ActivityScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  if (route.route !== "log.list") return null;
  return <ActivityPage filter={route.search.filter} project={project} run={route.search.run} />;
}
