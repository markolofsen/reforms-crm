"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { CONVERSATION_STATE_LABELS } from "@hub/contract/conversations";
import { refOf } from "@hub/contract/focus";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationLabel } from "@hub/ui/product/conversation";
import { ConversationBackButton, ConversationFrame, ConversationHeader, ConversationHeaderFacts, ConversationHistoryState, ConversationScrollToLatest } from "@hub/ui/product/conversation-frame";
import type { ConversationScrollState } from "@hub/ui/product/conversation-scroll";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import { toastManager } from "@hub/ui/toast";
import { ConversationHeaderActions } from "@/components/conversation/header-actions";
import { EmptyState, LoadFailed } from "@/components/state-views";
import { DraftCard } from "@/features/review/card/draft-card";
import type { ConversationRow } from "@/features/review/source";
import type { Notice, ReviewActions } from "@/features/review/use-review-actions";
import { ApiFailure, refreshData, sentence } from "@/lib/api/client";
import { inboundApi } from "@/lib/api/inbox";
import { reviewApi } from "@/lib/api/review";
import { keys } from "@/lib/cache/keys";
import { focusAgentRow } from "@/lib/focus";
import { notionIdentityLine, notionIndicatorState, notionPageIdOf } from "@/lib/notion";
import { usePrepare } from "../inbox/use-prepare";
import { MailComposerNotice, MailManualReply } from "./manual-reply";
import { History } from "./history";

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

/** Wrote you with no draft yet: the owner can write the draft here or ask the agent to prepare one. */
function WroteActions({ project, row }: { project: string; row: ConversationRow }) {
  const prepare = usePrepare(project);
  const dismiss = useDismiss(project);
  if (row.state !== "wrote" || row.draft) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton data-testid="prepare-reply" onClick={() => prepare([{ email: row.client.email, subject: row.subject }])} size="s" variant="secondary">
        Prepare reply
      </ActionButton>
      {row.inboundId !== null && (
        <ActionButton data-testid="no-reply-needed" disabled={dismiss.isPending} onClick={() => row.inboundId !== null && dismiss.mutate(row.inboundId)} size="s" variant="secondary">
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
  notice: Notice | null;
  /** `?m=`: one of their messages to open and scroll to. */
  pointed: string | null;
  actions: ReviewActions;
  now: number;
  advance: () => void;
  say: (text: string) => void;
  onBack: () => void;
};

/**
 * One conversation (P99 S3, verdicts 4 and 5): the person's name, address, Notion and Open in Mail; the whole correspondence across
 * threads with a divider per thread; and at the bottom the one open draft as the unsent message, today's card body (Checked, Send,
 * Skip, Hold, Done, Undo). Without a draft, the owner always has a manual composer; an open incoming message also offers Prepare reply.
 */
export function ConversationPane({ project, clientId, listRow, pointed, actions, notice, now, advance, say, onBack }: PaneProps) {
  const q = useQuery({ queryKey: keys.conversation(project, clientId), queryFn: () => reviewApi.conversation(project, clientId) });
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  // The history's scroll position and newest message belong to the conversation (and pointed message) they were read for, so
  // opening another one shows none until its history reports (stored with their key, no reset effect).
  const scrollKey = `${clientId}|${pointed ?? ""}`;
  const [scroll, setScroll] = useState<{ key: string; state: ConversationScrollState } | null>(null);
  const [source, setSource] = useState<{ clientId: number; messageId: string | null } | null>(null);
  const scrollState = scroll?.key === scrollKey ? scroll.state : null;
  const sourceMessageId = source?.clientId === clientId ? source.messageId : null;
  const onHistoryNote = useCallback((note: string | null) => setHistoryNote(note), []);
  const onHistoryScrollState = useCallback((next: ConversationScrollState) => setScroll({ key: scrollKey, state: next }), [scrollKey]);
  const onHistorySourceMessageId = useCallback((messageId: string | null) => setSource({ clientId, messageId }), [clientId]);
  const row = q.data?.row ?? listRow;
  const notion = row?.notion;
  const notionState = notion ? notionIndicatorState(notion) : null;
  const notionDetail = notion && row ? notionIdentityLine(notion, row.client.name) : undefined;
  const pageId = notion?.state === "resolved" ? notion.pageId ?? notionPageIdOf(notion.url) : null;
  const newest = sourceMessageId ?? row?.draft?.mailRef ?? null;
  const restoreListFocus = () => {
    focusAgentRow(refOf("client", row?.client.id ?? clientId));
  };
  const composer = row && row.draft ? (
    <DraftCard actions={actions} advance={advance} contact={row.contact} composerNotice={notice || historyNote ? <MailComposerNotice historyNote={historyNote} notice={notice} /> : undefined} d={row.draft} embedded key={row.draft.id} now={now} project={project} say={say} />
  ) : row ? (
    <MailManualReply
      composer={q.data?.composer ?? { brand: null, wroteTo: null, from: null, technicalAddress: null, language: "en", signatureLines: [], signatureFallback: null, signatureLinesByLanguage: { en: [], ru: [] }, signatureFallbackByLanguage: { en: null, ru: null }, status: "needs_mail", reason: "Mail context is still loading", brands: [] }}
      clientId={row.client.id}
      extra={row.state === "wrote" && row.inboundId !== null ? <WroteActions project={project} row={row} /> : undefined}
      hasOpenIncoming={row.inboundId !== null}
      historyNote={historyNote}
      notice={notice}
      project={project}
      key={`manual:${row.client.id}`}
    />
  ) : undefined;
  const history = row ? (
    <History clientId={row.client.id} name={row.client.name || row.client.email} onNote={onHistoryNote} onScrollState={onHistoryScrollState} onSourceMessageId={onHistorySourceMessageId} pointed={pointed} project={project} />
  ) : q.isPending ? (
    <ConversationHistoryState flush><EmptyState title="Opening the conversation">The Hub looks the person up.</EmptyState></ConversationHistoryState>
  ) : q.isError && !(q.error instanceof ApiFailure && q.error.status === 404) ? (
    <ConversationHistoryState><LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the conversation" /></ConversationHistoryState>
  ) : (
    <ConversationHistoryState flush><EmptyState title="Not found">This person has no conversation in this project.</EmptyState></ConversationHistoryState>
  );
  return (
    <ConversationFrame
      ariaLabel={`Conversation with ${row?.client.name || row?.client.email || "this person"}`}
      composer={composer}
      dataAgentRef={refOf("client", row?.client.id ?? clientId)}
      dataState={row?.state}
      historyActions={scrollState && !scrollState.atLatest ? <ConversationScrollToLatest onClick={scrollState.scrollToLatest} /> : undefined}
      header={<ConversationHeader back={<ConversationBackButton onClick={onBack} onRestoreFocus={restoreListFocus} />} actions={<ConversationHeaderActions contact={row?.contact} mailMessageId={newest} notionPageId={pageId} />} subtitle={row ? <ConversationHeaderFacts><ConversationLabel className="min-w-0 max-w-[min(24rem,45vw)] truncate" value={row.client.email} /><span data-testid="conversation-state">{CONVERSATION_STATE_LABELS[row.state]}</span>{notionState && <span data-testid="conversation-notion"><IntegrationStatus detail={notionDetail} label="Notion" state={notionState} /></span>}</ConversationHeaderFacts> : q.isPending ? "Loading conversation…" : "Conversation unavailable"} title={row?.client.name || row?.client.email || "Conversation"} />}
      testId="conversation"
    >
      {history}
    </ConversationFrame>
  );
}
