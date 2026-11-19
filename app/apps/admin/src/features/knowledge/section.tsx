"use client";

import { Page } from "@hub/ui/product/page";
import { useProjectScope } from "@/hooks/use-project";
import { KnowledgeView } from "./knowledge-view";

/** The Knowledge screen (P70, `/knowledge`, `g k`): the facts the agent cites in the owner's name, content he reads and corrects. */
export function KnowledgeScreen() {
  const { project } = useProjectScope();
  return (
    <Page>
      <KnowledgeView project={project} />
    </Page>
  );
}
