import { useQuery } from "@tanstack/react-query";
import { LoadFailed } from "@/components/state-views";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { FactLine } from "../fact-line";
import { HealthLine, SetupLine } from "./doctor-panel";
import { FiltersLine } from "./filters-line";
import { SafetyRules } from "./safety-rules";

/**
 * Project · Setup (P63 N2): "is this project set up right", one question, in the order of `admin-principles.md` rule 9: the
 * setup facts (status, who drafts may go to), the mail filters, the health checks, then Advanced (the safety rules). One line
 * each, closed unless a problem; Advanced opens when a rule is off. What lives in project.md changes by a phrase to the agent.
 */
export function SetupPage({ project }: { project: string }) {
  const facts = useQuery({ queryKey: keys.project(project), queryFn: () => metaApi.overview(project) });
  return (
    <section aria-labelledby="project-setup">
      <h3 className="sr-only" id="project-setup">
        Setup of this project
      </h3>
      {facts.isError && <LoadFailed error={facts.error} onRetry={() => void facts.refetch()} retrying={facts.isFetching} what="the project files" />}
      <ul className="flex flex-col divide-y border-y">
        <SetupLine project={project} />
        {facts.data ? <FiltersLine f={facts.data.filters} /> : !facts.isError && <FactLine summary="Reading..." title="Mail filters" />}
        <HealthLine project={project} />
        <SafetyRules project={project} />
      </ul>
    </section>
  );
}
