"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboundDetailDto } from "@hub/contract/inbound";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { refOf } from "@hub/contract/focus";
import { AppLink } from "@/components/app-link";
import { LocalActionButton } from "@/components/local-action";
import { EmptyState, LoadFailed } from "@/components/state-views";
import { refreshData, sentence } from "@/lib/api/client";
import { inboundApi } from "@/lib/api/inbox";
import { keys } from "@/lib/cache/keys";
import { agentRef } from "@/lib/focus";
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

const ANSWER_WORDS: Record<string, string> = { ready: "Draft ready", hold: "Draft on hold", sent: "Reply sent", done: "Reply done", skipped: "Draft skipped" };

/** The client's words, read from Mail (a Mail read: on open and on focus only, decision 0013). */
function MessageText({ project, id, preview }: { project: string; id: number; preview: string }) {
  const q = useQuery({ queryKey: keys.inboundText(project, id), queryFn: () => inboundApi.text(project, id) });
  if (q.isPending) return <p className="text-muted-foreground text-sm">The Hub asks Mail for the text.</p>;
  const { text = null, note = null, quoted = false } = q.data ?? {};
  return (
    <>
      <section aria-label="The client's message" className="measure whitespace-pre-wrap break-words text-sm" data-testid="inbound-text">
        {text ?? (
          <>
            <span className="text-muted-foreground">{note ?? (q.isError ? "Mail could not show this message." : "Mail did not show the text.")}</span>
            {preview && <span className="block pt-2">{preview}</span>}
          </>
        )}
      </section>
      {text !== null && quoted && <p className="text-muted-foreground text-xs">The quote of the earlier mail is folded away; Open in Mail shows it.</p>}
    </>
  );
}

/** P98 item 3: the draft that answers this message, as soon as the Hub records it (live): its state, its text and Open draft. */
function Answer({ a }: { a: NonNullable<InboundDetailDto["answer"]> }) {
  return (
    <section aria-label="The reply" className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-status={a.status} data-testid="inbound-answer">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{ANSWER_WORDS[a.status] ?? `Draft ${a.status}`}</span>
        <span className="text-muted-foreground">
          Draft {a.id}: {a.subject || "(no subject)"}
        </span>
      </p>
      {a.excerpt && <p className="measure line-clamp-4 whitespace-pre-wrap break-words text-muted-foreground">{a.excerpt}</p>}
      <div>
        <AppLink className="inline-flex min-h-11 items-center font-medium lg:min-h-8" data-testid="inbound-answer-open" to={paths.mail.item(a.id, { filter: a.status === "ready" ? "ready" : "all" })}>
          Open draft
        </AppLink>
      </div>
    </section>
  );
}

/**
 * One message a client wrote (P96 verdict 6): who, the subject, when, and the client's own words read from Mail now (the quote
 * of our earlier mail folded away), the client's drafts as links, the Notion link. Prepare reply pastes the request into the
 * dock without Enter (S2); No reply needed closes the client in Inbox with Undo; Open in Mail opens the message. No reply box:
 * writing is the agent's (decision 0025). P98: the state (open, drafts, the answering draft) is the Hub's record, refreshed live;
 * the moment the agent's draft is recorded the card says "Draft ready" with its text and Open draft, and Prepare reply goes.
 */
export function InboundCard({ project, id, onClosed }: { project: string; id: number; onClosed: () => void }) {
  const q = useQuery({ queryKey: keys.inboundItem(project, id), queryFn: () => inboundApi.get(project, id) });
  const now = useClock()();
  const prepare = usePrepare(project);
  const dismiss = useDismiss(project, onClosed);
  if (q.isPending) return <EmptyState title="Reading the message">The Hub looks the message up.</EmptyState>;
  if (!q.data)
    return (
      <div className="p-4">
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the message" />
      </div>
    );
  const { row, drafts, others, notionUrl, answer } = q.data;
  const pageId = notionPageId(notionUrl);
  const rest = drafts.filter((d) => d.id !== answer?.id);
  return (
    <article aria-label={`Message from ${row.name}`} className="flex flex-col gap-4 p-4 sm:p-6" data-open={row.open} data-testid="inbound-card" {...agentRef(refOf("inbound", row.id))}>
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
      {!row.open && answer && !row.dismissedAt && <Answer a={answer} />}
      {!row.open && (row.dismissedAt || !answer) && <p className="text-muted-foreground text-sm">{row.dismissedAt ? "Marked: no reply needed." : "A record of the agent came after this message: it left Inbox."}</p>}
      <MessageText id={row.id} preview={row.preview} project={project} />
      {(rest.length > 0 || others.length > 0) && (
        <section aria-label="Thread" className="flex flex-col gap-1 text-sm">
          {others.map((o) => (
            <AppLink key={`m${o.id}`} to={paths.mail.inbound(o.id, { filter: "inbox" })}>
              Also wrote: {o.subject || "(no subject)"} · {ago(o.receivedAt, now)}
            </AppLink>
          ))}
          {rest.map((d) => (
            <AppLink key={`d${d.id}`} to={paths.mail.item(d.id, { filter: "all" })}>
              Draft {d.id}: {d.subject || "(no subject)"} · {d.status}
            </AppLink>
          ))}
        </section>
      )}
    </article>
  );
}
