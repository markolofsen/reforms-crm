"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SEQUENCE_DISPLAY_LABELS } from "@hub/config";
import type { EnrollmentDto } from "@hub/contract/sequences";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { ListSkeleton, LoadFailed } from "@/components/state-views";
import { refreshData, sentence } from "@/lib/api/client";
import { sequencesApi } from "@/lib/api/inbox";
import { formatTime } from "@/lib/format";
import { paths } from "@/routes/paths";

/** Stop follow-ups for one client: it only reduces mail, but the admin cannot restart it (resume is the owner's, in his terminal), so it asks in place. */
function StopControl({ project, e }: { project: string; e: EnrollmentDto }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const stop = useMutation({ mutationFn: () => sequencesApi.stop(project, e.id), onSuccess: () => void refreshData(qc) });
  if (stop.isError) return <p className="text-destructive-foreground text-xs" role="alert">{sentence(stop.error)}</p>;
  if (!asking) return <ActionButton onClick={() => setAsking(true)} size="s" variant="quiet">Stop</ActionButton>;
  return (
    <span className="flex items-center gap-1">
      <ActionButton disabled={stop.isPending} onClick={() => stop.mutate()} size="s" variant="danger">
        {stop.isPending ? "Stopping" : "Stop follow-ups"}
      </ActionButton>
      <ActionButton onClick={() => setAsking(false)} size="s" variant="quiet">Keep</ActionButton>
    </span>
  );
}

function Row({ project, e }: { project: string; e: EnrollmentDto }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 border-t px-3 py-2 text-sm" data-testid="follow-up">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{e.client.name}</span>
        <Badge variant={e.display === "due" || e.display === "draft_ready" ? "info" : "outline"}>
          {SEQUENCE_DISPLAY_LABELS[e.display]} · step {e.step} of {e.steps}
        </Badge>
      </div>
      <p className="truncate text-muted-foreground">{e.sequenceName}</p>
      {e.enrolledPhrase && <p className="measure text-muted-foreground text-xs">Enrolled on your words: “{e.enrolledPhrase}”</p>}
      <div className="flex flex-wrap items-center gap-x-3 text-muted-foreground text-xs">
        {e.nextDueAt && <span>Due {formatTime(e.nextDueAt)}</span>}
        {e.openDraftId !== null && <AppLink to={paths.drafts.item(e.openDraftId, { filter: "sequences" })}>Open the step draft</AppLink>}
        {e.state !== "finished" && <span className="ms-auto"><StopControl e={e} project={project} /></span>}
      </div>
    </li>
  );
}

/**
 * Follow-ups (P47) in the Follow-ups view, under the open step drafts: every running enrolment, read-only but for Stop. The
 * agent enrols a client only on the owner's phrase in a session (D1 of P48), shown with the enrolment; the agent drafts each
 * due step into Mail, and the owner sends it from Mail. Nothing here enrols, drafts or sends.
 */
export function FollowUps({ project }: { project: string }) {
  const q = useQuery({ queryKey: ["enrollments", project, "active"], queryFn: () => sequencesApi.enrollments(project, "active") });
  if (q.isPending) return <ListSkeleton label="Loading the follow-ups" rows={2} />;
  if (!q.data) return <div className="p-3" data-testid="follow-ups-failed"><LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the follow-ups" /></div>;
  const rows = q.data.enrollments;
  return (
    <section aria-label="Follow-ups" className="mt-2 flex flex-col" data-testid="follow-ups">
      <h3 className="px-3 pt-2 pb-1 font-medium text-sm">In follow-up ({rows.length})</h3>
      {rows.length === 0 ? (
        <p className="measure px-3 pb-3 text-muted-foreground text-sm">
          Nobody is in a follow-up. Say to the agent: <code>подготовь follow-up молчащим клиентам проекта {project}</code>.
        </p>
      ) : (
        <ul aria-label="Clients in follow-up">{rows.map((e) => <Row e={e} key={e.id} project={project} />)}</ul>
      )}
    </section>
  );
}
