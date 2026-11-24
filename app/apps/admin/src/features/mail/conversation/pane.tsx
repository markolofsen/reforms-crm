"use client";

import { useCallback, useState } from "react";
import { CONVERSATION_STATE_LABELS } from "@hub/contract/conversations";
import { refOf } from "@hub/contract/focus";
import { ActionButton } from "@hub/ui/product/action-button";
import { DraftActionRow } from "@hub/ui/product/conversation/draft-action-row";
import { ConversationLabel } from "@hub/ui/product/conversation";
import { ConversationBackButton, ConversationFrame, ConversationHeader, ConversationHeaderFacts, ConversationHistoryState, ConversationScrollToLatest } from "@hub/ui/product/conversation/frame";
import type { ConversationScrollState } from "@hub/ui/product/conversation/scroll";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import { toastManager } from "@hub/ui/toast";
import { ConversationHeaderActions } from "@/components/conversation/header-actions";
import { RefreshConversation } from "./refresh";
import { ClientMapLine } from "@/components/conversation/client-map";
import { matchSources } from "@/components/conversation/client-map-sources";
import { EmptyState, LoadFailed } from "@/components/state-views";
import { DraftCard } from "@/features/mail/draft/draft-card";
import type { ConversationRow } from "@/features/mail/model";
import type { Notice, ReviewActions } from "@/features/mail/list/use-review-actions";
import { isNotFound, sentence } from "@/lib/api/client";
import { useConversation, useConversationMail } from "@/lib/data/conversations";
import { useDismissInbound } from "@/lib/data/inbound";
import { agentLine } from "@/lib/agent-reasons";
import { focusAgentRow } from "@/lib/focus";
import { notionIdentityLine, notionIndicatorState, notionPageIdOf } from "@/lib/notion";
import { usePrepare } from "../inbox/use-prepare";
import { MailComposerNotice, MailManualReply } from "./manual-reply";
import { History } from "./history";

/** No reply needed (P96 verdict 4): their open messages leave Needs you, stored, with Undo in the toast. */
function useDismiss(project: string) {
  const { dismiss, undo } = useDismissInbound(project, {
    onSuccess: (r) =>
      toastManager.add({
        title: "No reply needed",
        type: "success",
        actionProps: { children: "Undo", onClick: () => void undo(r.ids).catch((e: unknown) => toastManager.add({ title: "Not undone", description: sentence(e), type: "error" })) },
      }),
    onError: (e) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" }),
  });
  return dismiss;
}

/**
 * P128 X1, X2: a person with no draft. The composer rests closed: one action row. Wrote you: Prepare reply (primary) · No reply
 * needed · Write it myself; when the agent judged them (escalated or skipped, `row.agent`), its line is said and No reply needed is
 * the primary, Prepare reply beside it. Waiting and Done: only Write again. Writing opens the composer in place, focus in the body.
 */
function ReplyStart({ project, row, onWrite }: { project: string; row: ConversationRow; onWrite: () => void }) {
  const prepare = usePrepare(project);
  const dismiss = useDismiss(project);
  const write = (label: string) => (
    <ActionButton data-testid="write-myself" onClick={onWrite} size="s" variant="quiet">
      {label}
    </ActionButton>
  );
  if (row.state !== "wrote") return <DraftActionRow ariaLabel="Write" start={write("Write again")} testId="reply-start" />;
  const agentSaysNo = row.agent !== null && row.inboundId !== null;
  const prepareButton = (primary: boolean) => (
    <ActionButton data-testid="prepare-reply" key="prepare" onClick={() => prepare([{ email: row.client.email, subject: row.subject }])} size="s" variant={primary ? "primary" : "secondary"}>
      Prepare reply
    </ActionButton>
  );
  const noReply = (primary: boolean) =>
    row.inboundId === null ? null : (
      <ActionButton data-testid="no-reply-needed" disabled={dismiss.isPending} key="no-reply" onClick={() => row.inboundId !== null && dismiss.mutate(row.inboundId)} size="s" variant={primary ? "primary" : "secondary"}>
        No reply needed
      </ActionButton>
    );
  return (
    <DraftActionRow
      note={row.agent ? <p className="text-sm" data-testid="agent-verdict">{agentLine(row.agent)}</p> : undefined}
      primary={agentSaysNo ? noReply(true) : prepareButton(true)}
      start={
        <>
          {agentSaysNo ? prepareButton(false) : noReply(false)}
          {write("Write it myself")}
        </>
      }
      testId="reply-start"
    />
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
 * Skip, Hold, Done, Undo). Without a draft, one action row (P128 X1): the manual composer is one click away, Write it myself.
 */
export function ConversationPane({ project, clientId, listRow, pointed, actions, notice, now, advance, say, onBack }: PaneProps) {
  const q = useConversation(project, clientId);
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
  // P136 verdict 7c: a map node's sources, ringed in this person's thread (the Mail read the history already holds).
  const mail = useConversationMail(project, clientId);
  const [marked, setMarked] = useState<{ clientId: number; keys: string[]; label: string } | null>(null);
  const showSources = (refs: string[], label: string) => {
    const messages = (mail.data?.threads ?? []).flatMap((t) => t.messages).map((m) => ({ key: m.messageId, at: m.date, channel: "mail", messageId: m.messageId }));
    setMarked({ clientId, keys: matchSources(refs, messages), label });
  };
  const marks = marked?.clientId === clientId ? { keys: marked.keys, label: marked.label, onClear: () => setMarked(null) } : null;
  const notion = row?.notion;
  const notionState = notion ? notionIndicatorState(notion) : null;
  const notionDetail = notion && row ? notionIdentityLine(notion, row.client.name) : undefined;
  const pageId = notion?.state === "resolved" ? notion.pageId ?? notionPageIdOf(notion.url) : null;
  const newest = sourceMessageId ?? row?.draft?.mailRef ?? null;
  const restoreListFocus = () => {
    focusAgentRow(refOf("client", row?.client.id ?? clientId));
  };
  // P128 X1: the composer rests closed until "Write it myself" (or "Write again"); it belongs to the person it was opened for.
  const [writingFor, setWritingFor] = useState<number | null>(null);
  const writing = writingFor === clientId;
  const composer = row && row.draft ? (
    <DraftCard actions={actions} advance={advance} contact={row.contact} composerNotice={notice || historyNote ? <MailComposerNotice historyNote={historyNote} notice={notice} /> : undefined} d={row.draft} embedded key={row.draft.id} now={now} project={project} say={say} />
  ) : row && !writing ? (
    <div className="shrink-0 border-t bg-background px-4 py-3 lg:px-6">
      {(notice || historyNote) && <MailComposerNotice historyNote={historyNote} notice={notice} />}
      <ReplyStart onWrite={() => setWritingFor(clientId)} project={project} row={row} />
    </div>
  ) : row ? (
    <MailManualReply
      composer={q.data?.composer ?? { brand: null, wroteTo: null, from: null, technicalAddress: null, language: "en", signatureLines: [], signatureFallback: null, signatureLinesByLanguage: { en: [], ru: [] }, signatureFallbackByLanguage: { en: null, ru: null }, status: "needs_mail", reason: "Mail context is still loading", brands: [] }}
      clientId={row.client.id}
      hasOpenIncoming={row.inboundId !== null}
      historyNote={historyNote}
      notice={notice}
      onClose={() => setWritingFor(null)}
      project={project}
      key={`manual:${row.client.id}`}
    />
  ) : undefined;
  const history = row ? (
    <History clientId={row.client.id} marks={marks} name={row.client.name || row.client.email} onNote={onHistoryNote} onScrollState={onHistoryScrollState} onSourceMessageId={onHistorySourceMessageId} pointed={pointed} project={project} />
  ) : q.isPending ? (
    <ConversationHistoryState flush><EmptyState title="Opening the conversation">The Hub looks the person up.</EmptyState></ConversationHistoryState>
  ) : q.isError && !isNotFound(q.error) ? (
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
      header={<ConversationHeader back={<ConversationBackButton onClick={onBack} onRestoreFocus={restoreListFocus} />} actions={<ConversationHeaderActions contact={row?.contact} mailMessageId={newest} notionPageId={pageId} refresh={<RefreshConversation clientId={clientId} project={project} />} />} subtitle={row ? <ConversationHeaderFacts><ClientMapLine onShowSources={showSources} subject={{ project, clientId: row.client.id, name: row.client.name || row.client.email, email: row.client.email, notionPageId: pageId }} /><ConversationLabel className="min-w-0 max-w-[min(24rem,45vw)] truncate" value={row.client.email} /><span data-testid="conversation-state">{CONVERSATION_STATE_LABELS[row.state]}</span>{notionState && <span data-testid="conversation-notion"><IntegrationStatus detail={notionDetail} label="Notion" state={notionState} /></span>}</ConversationHeaderFacts> : q.isPending ? "Loading conversation…" : "Conversation unavailable"} title={row?.client.name || row?.client.email || "Conversation"} />}
      testId="conversation"
    >
      {history}
    </ConversationFrame>
  );
}
