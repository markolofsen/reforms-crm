"use client";

import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { ActivityPage } from "./activity-page";

/** The Activity screen: what the agent decided in this project. The view and the one client are read from the address. */
export function ActivityScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  if (route.route !== "log.list") return null;
  return <ActivityPage filter={route.search.filter} project={project} client={route.search.client} />;
}
