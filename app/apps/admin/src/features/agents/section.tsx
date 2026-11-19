"use client";

import { Page } from "@hub/ui/product/page";
import { useProjectScope } from "@/hooks/use-project";
import { AgentTools } from "./agent-tools/agent-tools";

/**
 * The Agents screen (P63 N2, route `/agents`, `/<project>/agents` with two or more): can this project's agent sessions work, and
 * how are they set. Scoped to the address's project, like Drafts: an agent session is always bound to one project. Today it
 * holds the Agent tools rows; P55's model and advisor group and P62's connector rows land here.
 */
export function AgentsScreen() {
  const { project } = useProjectScope();
  return (
    <Page>
      <AgentTools slug={project} />
    </Page>
  );
}
