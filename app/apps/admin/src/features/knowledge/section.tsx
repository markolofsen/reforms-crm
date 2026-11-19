"use client";

import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { KnowledgeView } from "./knowledge-view";

/** The Knowledge screen (P70, `/knowledge`, `g k`): the facts the agent cites in the owner's name, content he reads and corrects. */
export function KnowledgeScreen() {
  const { project } = useProjectScope();
  const route = useRoute();
  if (route.route !== "knowledge.page") return null;
  return <KnowledgeView filter={route.search.filter} project={project} q={route.search.q} />;
}
