import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { Menu, MenuPopup, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { LocalActionItem } from "@/components/local-action";
import { LoadFailed } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { metaApi } from "@/lib/api/meta";
import { useInstance, useProjectRow } from "@/lib/status";
import type { ProjectOverviewDto } from "@hub/contract/responses";
import { FactLine } from "./fact-line";
import { SendsTable, useSends } from "./sends-panel";
import { StopSending } from "./stop-sending";
import { keys } from "@/lib/cache/keys";

/**
 * Files (P61): the project's own files in Finder or their app, one menu and one tab stop. Opening is not an edit: what lives
 * in project.md is still changed by a phrase to the agent (`admin-principles.md` rule 9). Hidden when this machine cannot open.
 */
function FilesMenu({ project }: { project: string }) {
  const instance = useInstance();
  if (instance.data?.localOpen !== true) return null;
  return (
    <Menu>
      <MenuTrigger render={<ActionButton size="m" variant="quiet" />}>
        Files
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <LocalActionItem action="file.open" args={{ project, key: "project.md" }}>
          project.md
        </LocalActionItem>
        <LocalActionItem action="finder.open" args={{ project, key: "project" }}>
          Project folder
        </LocalActionItem>
        <LocalActionItem action="finder.open" args={{ project, key: "workflows" }}>
          Workflows
        </LocalActionItem>
      </MenuPopup>
    </Menu>
  );
}

/** A question the agent left in project.md for the owner: answered in a session, shown here so it is not missed (a decision, so it stays on the landing). */
function QuestionLine({ q }: { q: ProjectOverviewDto["question"] }) {
  if (!q) return null;
  return (
    <FactLine open summary={q.question} title="Open question" tone="problem">
      <p className="measure">{q.question}</p>
      {q.options.length > 0 && <p className="text-muted-foreground">Answer in a session: {q.options.join(", ")}.</p>}
    </FactLine>
  );
}

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
        <FilesMenu project={project} />
        <StopSending busy={busy || !q.data} onResume={(scope) => resume.mutate(scope)} onStop={(scope) => stop.mutate(scope)} project={project} stopped={q.data?.stopped ?? []} />
      </div>
      <p className="text-destructive-foreground text-sm" role="alert">
        {failed ? sentence(failed) : ""}
      </p>
    </div>
  );
}

/**
 * The Project landing (P63 N2): what is a decision or needs one. The status and Stop sending (or Resume); the sends, only when
 * one exists; the open question the agent left, when there is one. The facts that were one line each here live on their own
 * pages now (Knowledge; Setup: setup, mail filters, health, the safety rules), and their one word on Overview's parts table.
 */
export function ProjectPage({ project }: { project: string }) {
  const sends = useSends(project);
  const facts = useQuery({ queryKey: keys.project(project), queryFn: () => metaApi.overview(project) });
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
      {facts.isError && <LoadFailed error={facts.error} onRetry={() => void facts.refetch()} retrying={facts.isFetching} what="the project files" />}
      {facts.data?.question && (
        <ul aria-label="Open question" className="flex flex-col divide-y border-y">
          <QuestionLine q={facts.data.question} />
        </ul>
      )}
    </>
  );
}
