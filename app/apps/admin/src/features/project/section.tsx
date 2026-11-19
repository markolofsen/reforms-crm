"use client";

import { Page } from "@hub/ui/product/page";
import { SubNav } from "@/components/sub-nav";
import { useProjectScope } from "@/hooks/use-project";
import { KnowledgePage } from "./knowledge/knowledge-page";
import { ProjectPage } from "./project-page";
import { SetupPage } from "./setup/setup-page";

/** The Project screen: one project on one full-width page, its first line the status and Stop sending; the header holds the sub-nav to Knowledge and Setup (P63). */
export function ProjectScreen() {
  const { project } = useProjectScope();
  return (
    <Page nav={<SubNav section="project" />}>
      <ProjectPage project={project} />
    </Page>
  );
}

/** Project · Knowledge: the knowledge base of the project (P63 N2). */
export function KnowledgeScreen() {
  const { project } = useProjectScope();
  return (
    <Page nav={<SubNav section="project" />}>
      <KnowledgePage project={project} />
    </Page>
  );
}

/** Project · Setup: setup facts, mail filters, health checks and the safety rules (P63 N2). */
export function SetupScreen() {
  const { project } = useProjectScope();
  return (
    <Page nav={<SubNav section="project" />}>
      <SetupPage project={project} />
    </Page>
  );
}
