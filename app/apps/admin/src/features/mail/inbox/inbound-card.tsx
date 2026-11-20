"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboundDetailDto } from "@hub/contract/inbound";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { AppLink } from "@/components/app-link";
import { LocalActionButton } from "@/components/local-action";
import { EmptyState, LoadFailed } from "@/components/state-views";
import { refreshData, sentence } from "@/lib/api/client";
import { inboundApi } from "@/lib/api/inbox";
import { keys } from "@/lib/cache/keys";
import { useClock } from "@/lib/clock";
import { ago, formatTime } from "@/lib/format";
import { paths } from "@/routes/paths";
import { usePrepare } from "./use-prepare";

const WHY: Record<InboundDetailDto["row"]["why"], string> = { thread: "Answers a mail of ours", client: "A known client", test: "Your test address (test mode)" };
const notionPageId = (url: string | null): string | null => (url ? (/([0-9a-f]{32})(?:\?|$)/.exec(url.replace(/-/g, ""))?.[1] ?? null) : null);

/** No reply needed (verdict 4): the client leaves Inbox, stored, with Undo in the toast. */
function useDismiss(project: string, onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => inboundApi.dismiss(project, id),
    onSuccess: (r) => {
      void refreshData(qc);
      onDone();
      toastManager.add({
        title: "No reply needed",
        type: "success",
        actionProps: { children: "Undo", onClick: () => void inboundApi.undismiss(project, r.ids).then(() => refreshData(qc), (e: unknown) => toastManager.add({ title: "Not undone", description: sentence(e), type: "error" })) },
      });
    },
    onError: (e) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" }),
  });
}

/**
 * One message a client wrote (P96 verdict 6): who, the subject, when, and the client's own words read from Mail now (the quote
 * of our earlier mail folded away), the client's drafts as links, the Notion link. Prepare reply pastes the request into the
 * dock without Enter (S2); No reply needed closes the client in Inbox with Undo; Open in Mail opens the message. No reply box:
 * writing is the agent's (decision 0025).
 */
export function InboundCard({ project, id, onClosed }: { project: string; id: number; onClosed: () => void }) {
  const q = useQuery({ queryKey: keys.inboundText(project, id), queryFn: () => inboundApi.get(project, id) });
  const now = useClock()();
  const prepare = usePrepare(project);
  const dismiss = useDismiss(project, onClosed);
  if (q.isPending) return <EmptyState title="Reading the message">The Hub asks Mail for the text.</EmptyState>;
  if (!q.data)
    return (
      <div className="p-4">
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the message" />
      </div>
    );
  const { row, text, note, drafts, others, notionUrl, quoted } = q.data;
  const pageId = notionPageId(notionUrl);
  return (
    <article aria-label={`Message from ${row.name}`} className="flex flex-col gap-4 p-4 sm:p-6" data-testid="inbound-card">
      <header className="flex flex-col gap-1">
        <h2 className="font-semibold text-lg">{row.name}</h2>
        <p className="text-muted-foreground text-sm">
          {row.email} · {formatTime(row.receivedAt)} ({ago(row.receivedAt, now)}) · {WHY[row.why]}
        </p>
        <p className="font-medium">{row.subject || "(no subject)"}</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {row.open && (
          <ActionButton data-testid="prepare-reply" onClick={() => prepare([{ email: row.email, subject: row.subject }])} size="m" variant="primary">
            Prepare reply
          </ActionButton>
        )}
        {row.open && (
          <ActionButton data-testid="no-reply-needed" disabled={dismiss.isPending} onClick={() => dismiss.mutate(row.id)} size="m" variant="secondary">
            No reply needed
          </ActionButton>
        )}
        <LocalActionButton action="mail.openMessage" args={{ messageId: row.messageId }} size="m" variant="quiet" />
        {pageId && <LocalActionButton action="notion.openPage" args={{ pageId, app: true }} size="m" variant="quiet" />}
      </div>
      {!row.open && <p className="text-muted-foreground text-sm">{row.dismissedAt ? "Marked: no reply needed." : "A draft or a record of the agent came after this message: it left Inbox."}</p>}
      <section aria-label="The client's message" className="measure whitespace-pre-wrap break-words text-sm" data-testid="inbound-text">
        {text ?? (
          <>
            <span className="text-muted-foreground">{note ?? "Mail did not show the text."}</span>
            {row.preview && <span className="block pt-2">{row.preview}</span>}
          </>
        )}
      </section>
      {text !== null && quoted && <p className="text-muted-foreground text-xs">The quote of the earlier mail is folded away; Open in Mail shows it.</p>}
      {(drafts.length > 0 || others.length > 0) && (
        <section aria-label="Thread" className="flex flex-col gap-1 text-sm">
          {others.map((o) => (
            <AppLink key={`m${o.id}`} to={paths.mail.inbound(o.id, { filter: "inbox" })}>
              Also wrote: {o.subject || "(no subject)"} · {ago(o.receivedAt, now)}
            </AppLink>
          ))}
          {drafts.map((d) => (
            <AppLink key={`d${d.id}`} to={paths.mail.item(d.id, { filter: "all" })}>
              Draft {d.id}: {d.subject || "(no subject)"} · {d.status}
            </AppLink>
          ))}
        </section>
      )}
    </article>
  );
}
