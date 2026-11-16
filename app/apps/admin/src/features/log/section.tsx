"use client";

import { PaneScroll } from "@/features/shell/split-view";
import { PhoneProjectSwitcher } from "@/features/shell/project-switcher";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { ActivityPage } from "./activity-page";

/** The Activity screen: what the agent did in this project. The filter and the opened run are read from the address. */
export function ActivityScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  if (route.route !== "log.list") return null;
  return (
    <PaneScroll>
      <PhoneProjectSwitcher />
      <ActivityPage filter={route.search.filter} openId={route.search.run} project={project} />
    </PaneScroll>
  );
}
