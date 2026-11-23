import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AGENT_WORD_SEND_ACTOR, AGENT_WORD_SEND_LABEL, BATCH_SEND_ACTOR } from "@hub/config";
import type { SendRowDto } from "@hub/contract/sending";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { AppLink } from "@/components/app-link";
import { refreshData, sentence } from "@/lib/api/client";
import { sendApi } from "@/lib/api/send";
import { formatTime } from "@/lib/format";
import { dest } from "@/routes/paths";
import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { useSends } from "@/lib/status";

/** Cancel for a queued send inside its window (a sent mail cannot be recalled, so Cancel exists only while a send is queued). */
function useCancel(project: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => sendApi.cancel(project, id), onSuccess: () => refreshData(qc) });
}

const VIA = { manual: "By hand", auto: "Autosend" } as const;
const STATE: Record<SendRowDto["status"], string | null> = { sent: null, queued: "queued", sending: "sending", failed: "failed", cancelled: "cancelled" };

/** "By hand", "Batch" (P85b: Send all Checked of a batch), "Agent (your word)" (decision 0046), "Autosend · queued, goes out 15 Nov, 10:10". */
const by = (r: SendRowDto): string => (r.actor === BATCH_SEND_ACTOR ? "Batch" : r.actor === AGENT_WORD_SEND_ACTOR ? AGENT_WORD_SEND_LABEL : VIA[r.mode]);
const via = (r: SendRowDto): string => [by(r), STATE[r.status] && `${STATE[r.status]}${r.status === "queued" && r.dueAt ? `, goes out ${formatTime(r.dueAt)}` : ""}`].filter(Boolean).join(" · ");
const when = (r: SendRowDto): string => formatTime(r.doneAt ?? r.createdAt);

/** A messenger send's channel (P71 M4); a mail row has none. */
const CHANNEL: Record<Exclude<SendRowDto["channel"], "mail">, string> = { telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };
/** Who it went to: the addresses of a mail, or "Anna on Telegram" for a message (its row keeps the chat as `telegram:<id>`). */
const to = (r: SendRowDto): string => (r.channel === "mail" ? (r.ccAddr ? `${r.toAddr}, Cc ${r.ccAddr}` : r.toAddr) : `${r.subject} on ${CHANNEL[r.channel]}`);

/** The subject, linking to the conversation it belongs to (P99); a message has no subject, so its text. */
function Subject({ r }: { r: SendRowDto }) {
  const title = r.channel === "mail" ? r.subject : r.body;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {r.clientId === null || r.channel !== "mail" ? <span className="line-clamp-2 break-words">{title}</span> : <AppLink className="text-foreground text-sm" to={dest("mail.conversation", { id: r.clientId })}>{r.subject}</AppLink>}
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
function SendsTable({ sends, busy, onCancel }: Props) {
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
              <TableCell className="break-all">{to(r)}</TableCell>
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
              <span className="tabular-nums">{when(r)}</span> · {to(r)} · {via(r)}
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

/**
 * Activity ▸ Sends (UX pass 2026-11-20; on Settings ▸ Sending until then): every send the hub made or queued, newest first, Cancel
 * on a queued one. It is what happened, not a setting, so it sits with what the agent did; Stop sending stays on Sending.
 */
export function SendsView({ project }: { project: string }) {
  const q = useSends(project);
  const cancel = useCancel(project);
  if (q.isPending) return <ListSkeleton label="Loading the sends" />;
  if (!q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the sends" />;
  return (
    <>
      {q.data.sends.length === 0 ? <EmptyState title="No sends yet">A mail or a message you send from a draft appears here.</EmptyState> : <SendsTable busy={cancel.isPending} onCancel={(id) => cancel.mutate(id)} sends={q.data.sends} />}
      <p className="text-destructive-foreground text-sm" role="alert">
        {cancel.isError ? sentence(cancel.error) : ""}
      </p>
      {q.isError && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
    </>
  );
}
