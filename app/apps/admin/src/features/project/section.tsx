"use client";

import { PaneScroll } from "@/features/shell/split-view";
import { PhoneProjectSwitcher } from "@/features/shell/project-switcher";
import { useProjectScope } from "@/hooks/use-project";
import { ProjectPage } from "./project-page";

/** The Project screen: one project at a glance, one scrolling page (no sub-pages yet). */
export function ProjectScreen() {
  const { project } = useProjectScope();
  return (
    <PaneScroll>
      <PhoneProjectSwitcher />
      <ProjectPage project={project} />
    </PaneScroll>
  );
}
