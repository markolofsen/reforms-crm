import { Skeleton } from "@hub/ui/skeleton";
import { LoadFailed } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { useProjectRow } from "@/lib/status";
import { ChecksBeforeSending } from "./checks";
import { SendsTable, useSends } from "./sends-table";
import { SendPolicyLines } from "./send-to";
import { StopSending } from "./stop-sending";

/**
 * Sending's one sentence: the project's worst fact when Sending is where it is fixed (stopped, failed or stuck sends, the cap,
 * test mode), else whether sending runs. Said once; the lines below say the policy.
 */
function useSendingSentence(project: string, stopped: readonly string[] | undefined): string | null {
  const { row, isError } = useProjectRow(project);
  if (row && row.status.level !== "clear" && row.status.next === "sending") return row.status.sentence;
  if (stopped === undefined) return isError ? "The sending status could not be read." : null;
  return stopped.includes("*") || stopped.includes(project) ? "Sending is stopped" : "Sending is on";
}

/**
 * Settings ▸ Sending (P70, `/settings`, where Settings opens): what lets a mail out, in the order of `admin-principles.md` rule 9.
 * The sentence and the one control, Stop sending or Resume; the sends, only when one exists (Cancel on a queued one); who drafts
 * may go to and autosend, read only with the owner's command; the checks before sending, closed with a summary.
 */
export function SendingPane({ project }: { project: string }) {
  const sends = useSends(project);
  const { q, stop, resume, busy, failed } = sends;
  const said = useSendingSentence(project, q.data?.stopped);
  const list = q.data?.sends ?? [];
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex min-h-(--control-m) flex-wrap items-center gap-3">
          <div className="me-auto font-medium text-base" data-testid="sending-status" role="status">
            {said ?? <Skeleton className="h-4 w-64" />}
          </div>
          <StopSending busy={busy || !q.data} onResume={(scope) => resume.mutate(scope)} onStop={(scope) => stop.mutate(scope)} project={project} stopped={q.data?.stopped ?? []} />
        </div>
        <p className="text-destructive-foreground text-sm" role="alert">
          {failed ? sentence(failed) : ""}
        </p>
      </div>
      {q.isError && <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the sends" />}
      {list.length > 0 && (
        <section aria-labelledby="sending-sends" className="flex flex-col gap-1">
          <h3 className="font-heading font-medium text-sm" id="sending-sends">
            Sends
          </h3>
          <SendsTable busy={busy} onCancel={(id) => sends.cancel.mutate(id)} sends={list} />
        </section>
      )}
      <ul aria-label="Sending settings" className="flex flex-col divide-y border-y">
        <SendPolicyLines project={project} />
        <ChecksBeforeSending project={project} />
      </ul>
    </>
  );
}
