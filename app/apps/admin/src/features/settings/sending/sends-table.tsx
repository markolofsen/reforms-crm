import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SendRowDto } from "@hub/contract/responses";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { AppLink } from "@/components/app-link";
import { refreshData } from "@/lib/api/client";
import { sendApi } from "@/lib/api/send";
import { formatTime } from "@/lib/format";
import { paths } from "@/routes/paths";
import { keys } from "@/lib/cache/keys";

/**
 * The send history and the switch that stops it: every send the hub made or queued, Cancel for a queued one inside its
 * window, and Stop sending / Resume for this project or every project. A sent mail cannot be recalled, so Cancel exists
 * only while a send is queued. One hook, so the status line's Stop and the table share one query.
 */
export function useSends(project: string) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.sends(project), queryFn: () => sendApi.list(project) });
  const settle = { onSuccess: () => refreshData(qc) };
  const cancel = useMutation({ mutationFn: (id: number) => sendApi.cancel(project, id), ...settle });
  const stop = useMutation({ mutationFn: (scope: string) => sendApi.stop(scope), ...settle });
  const resume = useMutation({ mutationFn: (scope: string) => sendApi.resume(scope), ...settle });
  const failed = [cancel, stop, resume].find((m) => m.isError)?.error ?? null;
  return { q, cancel, stop, resume, busy: cancel.isPending || stop.isPending || resume.isPending, failed };
}

const VIA = { manual: "By hand", auto: "Autosend" } as const;
const STATE: Record<SendRowDto["status"], string | null> = { sent: null, queued: "queued", sending: "sending", failed: "failed", cancelled: "cancelled" };

/** "By hand", "Autosend · queued, goes out 15 Nov, 10:10". */
const via = (r: SendRowDto): string => [VIA[r.mode], STATE[r.status] && `${STATE[r.status]}${r.status === "queued" && r.dueAt ? `, goes out ${formatTime(r.dueAt)}` : ""}`].filter(Boolean).join(" · ");
const when = (r: SendRowDto): string => formatTime(r.doneAt ?? r.createdAt);

/** The subject, linking to the draft it came from (the full text lives in that card). */
function Subject({ r }: { r: SendRowDto }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {r.draftId === null ? r.subject : <AppLink className="text-foreground text-sm" to={paths.drafts.item(r.draftId)}>{r.subject}</AppLink>}
      {r.error && <span className="text-warning-foreground text-xs">{r.error}</span>}
    </span>
  );
}

function Cancel({ r, busy, onCancel }: { r: SendRowDto; busy: boolean; onCancel: (id: number) => void }) {
  if (r.status !== "queued") return null;
  return (
    <ActionButton aria-label={`Cancel send ${r.id}: ${r.subject}`} disabled={busy} onClick={() => onCancel(r.id)} size="s" variant="danger">
      Cancel send
    </ActionButton>
  );
}

type Props = { sends: readonly SendRowDto[]; busy: boolean; onCancel: (id: number) => void };

/** From 640px a table (when, to, subject, via); below it each send is two lines. */
export function SendsTable({ sends, busy, onCancel }: Props) {
  return (
    <>
      <DataTable aria-label="Sends" className="max-md:hidden">
        <TableHeader>
          <TableRow>
            <TableHead className="w-3/20">When</TableHead>
            <TableHead className="w-1/4">To</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead className="w-1/4">Via</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sends.map((r) => (
            <TableRow data-send={r.id} key={r.id}>
              <TableCell className="text-muted-foreground tabular-nums">{when(r)}</TableCell>
              <TableCell className="break-all">{r.ccAddr ? `${r.toAddr}, Cc ${r.ccAddr}` : r.toAddr}</TableCell>
              <TableCell>
                <Subject r={r} />
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-2">
                  {via(r)}
                  <Cancel busy={busy} onCancel={onCancel} r={r} />
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      <ul aria-label="Sends" className="flex flex-col divide-y md:hidden">
        {sends.map((r) => (
          <li className="flex min-w-0 flex-col gap-1 py-2 text-sm" key={r.id}>
            <Subject r={r} />
            <p className="break-all text-muted-foreground text-xs">
              <span className="tabular-nums">{when(r)}</span> · {r.toAddr} · {via(r)}
            </p>
            {r.status === "queued" && (
              <div>
                <Cancel busy={busy} onCancel={onCancel} r={r} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
