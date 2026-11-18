"use client";

import { Page } from "@hub/ui/product/page";
import { useProjectScope } from "@/hooks/use-project";
import { ProjectPage } from "./project-page";

/** The Project screen: one project on one full-width page, its first line the status and Stop sending. */
export function ProjectScreen() {
  const { project } = useProjectScope();
  return (
    <Page>
      <ProjectPage project={project} />
    </Page>
  );
}
