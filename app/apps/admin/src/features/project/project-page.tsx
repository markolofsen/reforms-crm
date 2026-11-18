import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@hub/ui/skeleton";
import { LoadFailed } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { metaApi } from "@/lib/api/meta";
import { useProjectRow } from "@/lib/status";
import { HealthLine, SetupLine } from "./doctor-panel";
import { FiltersLine, KnowledgeLine, QuestionLine } from "./facts";
import { SafetyRules } from "./safety-rules";
import { SendsTable, useSends } from "./sends-panel";
import { StopSending } from "./stop-sending";

/** The first line: the project's standing in one sentence (the Overview's status, said once) and the one control, Stop sending or Resume. */
function StatusLine({ project, sends }: { project: string; sends: ReturnType<typeof useSends> }) {
  const { row, isError } = useProjectRow(project);
  const { q, stop, resume, busy, failed } = sends;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-(--control-m) flex-wrap items-center gap-3">
        <div className="me-auto font-medium text-base" data-testid="project-status" role="status">
          {row ? row.status.sentence : isError ? "The status of this project could not be read." : <Skeleton className="h-4 w-64" />}
        </div>
        <StopSending busy={busy || !q.data} onResume={(scope) => resume.mutate(scope)} onStop={(scope) => stop.mutate(scope)} project={project} stopped={q.data?.stopped ?? []} />
      </div>
      <p className="text-destructive-foreground text-sm" role="alert">
        {failed ? sentence(failed) : ""}
      </p>
    </div>
  );
}

/**
 * One project, by frequency (`admin-principles.md` rule 9): the status and Stop sending; the sends, only when one exists;
 * then one line each for the facts (closed unless one is a problem); last Advanced, the safety rules. Read-only except
 * Stop, Cancel and the rules: what lives in project.md is changed by a phrase to the agent.
 */
export function ProjectPage({ project }: { project: string }) {
  const sends = useSends(project);
  const facts = useQuery({ queryKey: ["project", project], queryFn: () => metaApi.overview(project) });
  const list = sends.q.data?.sends ?? [];
  return (
    <>
      <StatusLine project={project} sends={sends} />
      {sends.q.isError && <LoadFailed error={sends.q.error} onRetry={() => void sends.q.refetch()} retrying={sends.q.isFetching} what="the sends" />}
      {list.length > 0 && (
        <section aria-labelledby="project-sends" className="flex flex-col gap-1">
          <h3 className="font-heading font-medium text-sm" id="project-sends">
            Sends
          </h3>
          <SendsTable busy={sends.busy} onCancel={(id) => sends.cancel.mutate(id)} sends={list} />
        </section>
      )}
      <section aria-labelledby="project-facts">
        <h3 className="sr-only" id="project-facts">
          About this project
        </h3>
        {facts.isError && <LoadFailed error={facts.error} onRetry={() => void facts.refetch()} retrying={facts.isFetching} what="the project files" />}
        <ul className="flex flex-col divide-y border-y">
          {facts.data && <QuestionLine q={facts.data.question} />}
          {facts.data && <KnowledgeLine k={facts.data.knowledge} />}
          {facts.data && <FiltersLine f={facts.data.filters} />}
          <HealthLine project={project} />
          <SetupLine project={project} />
          <SafetyRules project={project} />
        </ul>
      </section>
    </>
  );
}
