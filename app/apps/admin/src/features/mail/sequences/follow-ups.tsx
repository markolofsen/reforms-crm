"use client";

import { clientKey } from "@hub/contract/client-key";
import { phrase } from "@hub/contract/help";
import { useState } from "react";
import { SEQUENCE_DISPLAY_LABELS } from "@hub/config";
import type { EnrollmentDto } from "@hub/contract/sequences";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationList, ConversationListIdentity, ConversationListItem } from "@hub/ui/product/conversation";
import { AppLink } from "@/components/app-link";
import { ListSkeleton, ListState, QueryView } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { useEnrollments, useStopFollowUps } from "@/lib/data/inbound";
import { formatTime } from "@/lib/format";
import { dest } from "@/routes/paths";

/** Stop the sequence for one client: it only reduces mail, but the admin cannot restart it (resume is the owner's, in his terminal), so it asks in place. */
function StopControl({ project, e }: { project: string; e: EnrollmentDto }) {
  const [asking, setAsking] = useState(false);
  const stop = useStopFollowUps(project, e.id);
  if (stop.isError) return <p className="text-destructive-foreground text-xs" role="alert">{sentence(stop.error)}</p>;
  if (!asking) return <ActionButton onClick={() => setAsking(true)} size="s" variant="quiet">Stop</ActionButton>;
  return (
    <span className="flex items-center gap-1">
      <ActionButton disabled={stop.isPending} onClick={() => stop.mutate()} size="s" variant="danger">
        {stop.isPending ? "Stopping" : "Stop the sequence"}
      </ActionButton>
      <ActionButton onClick={() => setAsking(false)} size="s" variant="quiet">Keep</ActionButton>
    </span>
  );
}

function Row({ project, e }: { project: string; e: EnrollmentDto }) {
  return (
    <ConversationListItem className="flex min-w-0 flex-col gap-0.5 px-3 py-2 text-sm" dataAttributes={{ "data-testid": "sequence-enrolment" }}>
      <ConversationListIdentity name={e.client.name} time={<Badge variant={e.display === "due" || e.display === "draft_ready" ? "info" : "outline"}>{SEQUENCE_DISPLAY_LABELS[e.display]} · step {e.step} of {e.steps}</Badge>} />
      <p className="truncate text-muted-foreground">{e.sequenceName}</p>
      {e.enrolledPhrase && <p className="measure text-muted-foreground text-xs">Enrolled on your words: “{e.enrolledPhrase}”</p>}
      <div className="flex flex-wrap items-center gap-x-3 text-muted-foreground text-xs">
        {e.nextDueAt && <span>Due {formatTime(e.nextDueAt)}</span>}
        {e.openDraftId !== null && <AppLink to={dest("mail.conversation", { key: clientKey(e.client) }, { filter: "sequences" })}>Open the step draft</AppLink>}
        {e.state !== "finished" && <span className="ms-auto"><StopControl e={e} project={project} /></span>}
      </div>
    </ConversationListItem>
  );
}

/**
 * Sequence steps (P47; "Follow-ups" until P142 gave that name to the daily sweep) in the Sequence steps view, under the open step drafts: every running enrolment, read-only but for Stop. The
 * agent enrols a client only on the owner's phrase in a session (D1 of P48), shown with the enrolment; the agent drafts each
 * due step into Mail, and the owner sends it from Mail. Nothing here enrols, drafts or sends.
 */
export function FollowUps({ project }: { project: string }) {
  const q = useEnrollments(project, "active");
  return (
    <QueryView frame={(note, kind) => <ListState testId={kind === "failed" ? "sequence-steps-failed" : undefined}>{note}</ListState>} loading={<ListSkeleton label="Loading the sequences" rows={2} />} query={q} what="the sequences">
      {(d) => <FollowUpList project={project} rows={d.enrollments} />}
    </QueryView>
  );
}

/** The running enrolments, once read; a failed refetch's stale note sits above them (`QueryView`, state rule 5). */
function FollowUpList({ project, rows }: { project: string; rows: readonly EnrollmentDto[] }) {
  return (
    <section aria-label="Sequence steps" className="flex flex-col" data-testid="sequence-steps">
      <h3 className="px-3 pt-2 pb-1 font-medium text-sm">In a sequence ({rows.length})</h3>
      {rows.length === 0 ? (
        <p className="measure px-3 pb-3 text-muted-foreground text-sm">
          Nobody is in a sequence. Say to the agent: <code>{phrase("sequence-drafts", project)}</code>.
        </p>
      ) : (
        <ConversationList ariaLabel="Clients in a sequence">{rows.map((e) => <Row e={e} key={e.id} project={project} />)}</ConversationList>
      )}
    </section>
  );
}
