"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CONVERSATION_STATE_LABELS } from "@hub/contract/conversations";
import { refOf } from "@hub/contract/focus";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { LocalActionButton } from "@/components/local-action";
import { EmptyState, LoadFailed } from "@/components/state-views";
import { DraftCard } from "@/features/review/card/draft-card";
import type { ConversationRow } from "@/features/review/source";
import type { ReviewActions } from "@/features/review/use-review-actions";
import { refreshData, sentence } from "@/lib/api/client";
import { inboundApi } from "@/lib/api/inbox";
import { reviewApi } from "@/lib/api/review";
import { keys } from "@/lib/cache/keys";
import { agentRef } from "@/lib/focus";
import { usePrepare } from "../inbox/use-prepare";
import { History } from "./history";

const notionPageId = (url: string | null): string | null => (url ? (/([0-9a-f]{32})(?:\?|$)/.exec(url.replace(/-/g, ""))?.[1] ?? null) : null);

/** No reply needed (P96 verdict 4): their open messages leave Needs you, stored, with Undo in the toast. */
function useDismiss(project: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => inboundApi.dismiss(project, id),
    onSuccess: (r) => {
      void refreshData(qc);
      toastManager.add({
        title: "No reply needed",
        type: "success",
        actionProps: { children: "Undo", onClick: () => void inboundApi.undismiss(project, r.ids).then(() => refreshData(qc), (e: unknown) => toastManager.add({ title: "Not undone", description: sentence(e), type: "error" })) },
      });
    },
    onError: (e) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" }),
  });
}

/** Wrote you with no draft yet (P96 S2): Prepare reply pastes the request into the dock without Enter; No reply needed closes it. */
function WroteActions({ project, row }: { project: string; row: ConversationRow }) {
  const prepare = usePrepare(project);
  const dismiss = useDismiss(project);
  if (row.state !== "wrote" || row.draft) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton data-testid="prepare-reply" onClick={() => prepare([{ email: row.client.email, subject: row.subject }])} size="m" variant="primary">
        Prepare reply
      </ActionButton>
      {row.inboundId !== null && (
        <ActionButton data-testid="no-reply-needed" disabled={dismiss.isPending} onClick={() => row.inboundId !== null && dismiss.mutate(row.inboundId)} size="m" variant="secondary">
          No reply needed
        </ActionButton>
      )}
    </div>
  );
}

export type PaneProps = {
  project: string;
  clientId: number;
  /** The row of the list when it holds this person (instant); the pane reads its own copy too (a person outside the view). */
  listRow: ConversationRow | null;
  /** `?m=`: one of their messages to open and scroll to. */
  pointed: string | null;
  actions: ReviewActions;
  now: number;
  thread: boolean;
  onThread: () => void;
  advance: () => void;
  say: (text: string) => void;
};

/**
 * One conversation (P99 S3, verdicts 4 and 5): the person's name, address, Notion and Open in Mail; the whole correspondence across
 * threads with a divider per thread; and at the bottom the one open draft as the unsent message, today's card body (Checked, Send,
 * Skip, Hold, Done, Undo), where P93's editor will land. Without a draft and with their message waiting: Prepare reply.
 */
export function ConversationPane({ project, clientId, listRow, pointed, actions, now, thread, onThread, advance, say }: PaneProps) {
  const q = useQuery({ queryKey: keys.conversation(project, clientId), queryFn: () => reviewApi.conversation(project, clientId) });
  const row = q.data?.row ?? listRow;
  if (!row) {
    if (q.isPending) return <EmptyState title="Opening the conversation">The Hub looks the person up.</EmptyState>;
    return q.isError ? (
      <div className="p-4">
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the conversation" />
      </div>
    ) : (
      <EmptyState title="Not found">This person has no conversation in this project.</EmptyState>
    );
  }
  const pageId = notionPageId(q.data?.notionUrl ?? null);
  const newest = row.draft?.mailRef ?? null;
  return (
    <article aria-label={`Conversation with ${row.client.name || row.client.email}`} className="flex min-h-0 min-w-0 flex-1 flex-col" data-state={row.state} data-testid="conversation" {...agentRef(refOf("client", row.client.id))}>
      <div className="flex min-w-0 flex-col gap-3 border-b p-4 lg:px-6">
        <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="min-w-0 truncate font-semibold text-lg">{row.client.name || row.client.email}</h2>
          <span className="min-w-0 truncate text-muted-foreground text-sm">{row.client.email}</span>
          <span className="text-sm" data-testid="conversation-state">{CONVERSATION_STATE_LABELS[row.state]}</span>
          <span className="ms-auto flex flex-wrap gap-1">
            {pageId && <LocalActionButton action="notion.openPage" args={{ pageId, app: true }} size="s" variant="quiet" />}
            {newest && <LocalActionButton action="mail.openMessage" args={{ messageId: newest }} size="s" variant="quiet" />}
          </span>
        </header>
        <WroteActions project={project} row={row} />
        <History clientId={row.client.id} name={row.client.name || row.client.email} pointed={pointed} project={project} />
      </div>
      {row.draft ? (
        <DraftCard actions={actions} advance={advance} d={row.draft} key={row.draft.id} now={now} onThread={onThread} project={project} say={say} thread={thread} />
      ) : (
        <p className="p-4 text-muted-foreground text-sm lg:px-6" data-testid="no-unsent">
          {row.state === "wrote" ? "No draft yet: Prepare reply asks the agent for one." : "No unsent message. A new one is a phrase to the agent in the dock."}
        </p>
      )}
    </article>
  );
}
