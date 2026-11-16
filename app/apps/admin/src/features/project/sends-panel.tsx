import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SendRowDto } from "@hub/contract/responses";
import { EmptyState, LoadFailed, Loading } from "@/components/state-views";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/action-button";
import { refreshData, sentence } from "@/lib/api/client";
import { sendApi } from "@/lib/api/send";
import { formatTime } from "@/lib/format";
import { StopSending } from "./stop-sending";

const STATUS_VARIANT = { sent: "success", queued: "info", sending: "warning", failed: "error", cancelled: "secondary" } as const;

function SendRow({ row, onCancel, busy }: { row: SendRowDto; onCancel: (id: number) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
        <span className="min-w-0 max-w-full truncate font-medium text-sm">{row.subject}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{formatTime(row.status === "queued" && row.dueAt ? row.dueAt : (row.doneAt ?? row.createdAt))}</span>
      </div>
      <p className="break-all text-muted-foreground text-xs">
        To {row.toAddr}
        {row.ccAddr ? `, Cc ${row.ccAddr}` : ""} ({row.mode === "auto" ? "autosend" : "by hand"}, {row.actor})
        {row.status === "queued" && row.dueAt ? `, goes out ${formatTime(row.dueAt)}` : ""}
      </p>
      {row.error && <p className="break-words text-xs text-warning-foreground">{row.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} text, send ${row.id}`} onClick={() => setOpen(!open)} size="s" variant="quiet">
          {open ? "Hide text" : "Show text"}
        </ActionButton>
        {row.status === "queued" && (
          <ActionButton aria-label={`Cancel send ${row.id}: ${row.subject}`} disabled={busy} onClick={() => onCancel(row.id)} size="s" variant="danger">
            Cancel send
          </ActionButton>
        )}
      </div>
      {open && <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-sans text-sm">{row.body}</pre>}
    </li>
  );
}

/**
 * The send history of a project and the switch that stops it: every send the hub made or queued (full text kept), Cancel
 * for a queued one inside its window, and one Stop sending / Resume for this project or for every project. A sent mail cannot
 * be recalled, so Cancel exists only while a send is queued.
 */
export function SendsPanel({ project }: { project: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sends", project], queryFn: () => sendApi.list(project) });
  const settle = { onSuccess: () => refreshData(qc) };
  const cancel = useMutation({ mutationFn: (id: number) => sendApi.cancel(project, id), ...settle });
  const stop = useMutation({ mutationFn: (scope: string) => sendApi.stop(scope), ...settle });
  const resume = useMutation({ mutationFn: (scope: string) => sendApi.resume(scope), ...settle });
  if (q.isPending) return <Loading what="the sends" />;
  if (q.isError) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the sends" />;
  const { sends, stopped } = q.data;
  const busy = cancel.isPending || stop.isPending || resume.isPending;
  const failed = [cancel, stop, resume].find((m) => m.isError);
  return (
    <div className="flex flex-col gap-3">
      <StopSending busy={busy} onResume={(scope) => resume.mutate(scope)} onStop={(scope) => stop.mutate(scope)} project={project} stopped={stopped} />
      {failed?.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(failed.error)}
        </p>
      )}
      {sends.length === 0 ? (
        <EmptyState title="Nothing sent yet">A draft you have read the checks for has a Send button on the Drafts screen.</EmptyState>
      ) : (
        <ul aria-label="Sends" className="divide-y">
          {sends.map((r) => (
            <SendRow busy={busy} key={r.id} onCancel={(id) => cancel.mutate(id)} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
