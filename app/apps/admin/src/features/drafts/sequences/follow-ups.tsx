"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import type { EnrollmentDto } from "@hub/contract/sequences";
import { Badge } from "@hub/ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { Skeleton } from "@hub/ui/skeleton";
import { AppLink } from "@/components/app-link";
import { LoadFailed } from "@/components/state-views";
import { sequencesApi } from "@/lib/api/inbox";
import { formatTime } from "@/lib/format";
import { paths } from "@/routes/paths";
import { Candidates } from "./candidates";

function DueRow({ e }: { e: EnrollmentDto }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 border-t px-3 py-2 text-sm" data-testid="follow-up-due">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{e.client.name}</span>
        <Badge variant={e.display === "draft_ready" ? "info" : "warning"}>
          {e.display === "draft_ready" ? "Draft ready" : "Due"} · step {e.step} of {e.steps}
        </Badge>
      </div>
      <p className="truncate text-muted-foreground">{e.sequenceName}</p>
      <p className="flex flex-wrap items-center gap-x-3 text-muted-foreground text-xs">
        {e.nextDueAt && <span>Due {formatTime(e.nextDueAt)}</span>}
        {e.last && <span>Our last message {formatTime(e.last.at)}</span>}
        {e.openDraftId !== null && (
          <AppLink className="text-xs" to={paths.drafts.item(e.openDraftId)}>
            Open the step draft
          </AppLink>
        )}
      </p>
    </li>
  );
}

/**
 * Follow-ups (P47) under the draft list: the steps due now and the quiet clients the owner might enrol. Collapsed, and
 * absent when both are empty. Nothing here drafts or sends: the agent drafts the due steps when told to, the owner sends
 * each from Mail, and only the owner enrols (the agent's shell has no Enrol).
 */
export function FollowUps({ project }: { project: string }) {
  const due = useQuery({ queryKey: ["enrollments", project, "due"], queryFn: () => sequencesApi.enrollments(project, "due") });
  const offered = useQuery({ queryKey: ["enrollment-candidates", project], queryFn: () => sequencesApi.candidates(project) });
  if (due.isPending || offered.isPending) {
    return (
      <div className="mx-3 mt-3">
        <Skeleton className="h-(--control-m) w-full rounded-lg" />
        <p className="sr-only" role="status">Loading the follow-ups...</p>
      </div>
    );
  }
  if (!due.data || !offered.data) {
    const failed = due.isError ? due : offered;
    return (
      <div className="mx-3 mt-3" data-testid="follow-ups-failed">
        <LoadFailed
          error={failed.error}
          onRetry={() => {
            void due.refetch();
            void offered.refetch();
          }}
          retrying={due.isFetching || offered.isFetching}
          what="the follow-ups"
        />
      </div>
    );
  }
  const rows = due.data.enrollments;
  const candidates = offered.data.candidates;
  if (rows.length === 0 && candidates.length === 0) return null;
  return (
    <Collapsible className="mx-3 mt-3 rounded-lg border" data-testid="follow-ups">
      <CollapsibleTrigger className="flex min-h-(--control-m) w-full items-center gap-2 px-3 py-2 text-start text-sm">
        <span className="min-w-0 flex-1">
          <span className="font-medium">Follow-ups</span> <span className="text-muted-foreground">{rows.length} due, {candidates.length} suggested</span>
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <section aria-label="Follow-ups due">
          <h4 className="px-3 pb-1 font-medium text-sm">Due</h4>
          {rows.length === 0 ? (
            <p className="border-t px-3 py-2 text-muted-foreground text-sm">Nothing is due.</p>
          ) : (
            <>
              <p className="px-3 pb-2 text-muted-foreground text-xs">
                Say to the agent: <code>подготовь follow-up проекта {project}</code>. It drafts each due step into Mail; you send it from Mail.
              </p>
              <ul aria-label="Due follow-ups">{rows.map((e) => <DueRow e={e} key={e.id} />)}</ul>
            </>
          )}
        </section>
        <Candidates candidates={candidates} project={project} />
      </CollapsiblePanel>
    </Collapsible>
  );
}
