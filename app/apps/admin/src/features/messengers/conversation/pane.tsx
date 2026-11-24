"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MESSENGER_TEXT_MAX } from "@hub/config/chat-rules";
import { composerStateOf } from "@hub/contract/composer";
import type { MessengerConversationMessageDto } from "@hub/contract/messenger-panel";
import { refOf } from "@hub/contract/focus";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationDayDivider, ConversationLabel, ConversationMessage, ConversationMessageList, ConversationText } from "@hub/ui/product/conversation";
import { ConversationBackButton, ConversationComposerFooter, ConversationFrame, ConversationHeader, ConversationHeaderFacts, ConversationHistoryContent, ConversationHistoryNotice, ConversationHistoryState, ConversationHistorySummary, ConversationRefreshing, ConversationScrollToLatest, ConversationStaleNotice } from "@hub/ui/product/conversation/frame";
import { ConversationComposerEditor } from "@hub/ui/product/composer/editor";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import { useConversationScroll } from "@hub/ui/product/conversation/scroll";
import { ConversationHeaderActions } from "@/components/conversation/header-actions";
import { ClientMapLine } from "@/components/conversation/client-map";
import { MapMarksNote } from "@/components/conversation/client-map-view";
import { matchSources } from "@/components/conversation/client-map-sources";
import { cn } from "@hub/ui/cn";
import { EmptyState, LoadFailed, Loading } from "@/components/state-views";
import { notionPageIdOf } from "@/lib/notion";
import { focusAgentRow } from "@/lib/focus";
import { useManualMessengerDraft, useMessengerConversation, usePrepareReply } from "@/lib/data/messengers";
import { isNotFound, sentence } from "@/lib/api/client";
import { dayOf, formatDay, formatTime } from "@/lib/format";
import { CHANNEL_LABEL, chatName, chatStateLine, doneLine, handleLine, identityLine, notionIdentityLine, notionIndicatorState } from "../labels";
import { CreateClient, RecordSearch } from "../unlinked/record-search";
import { dialogOf, UnlinkedHeaderButtons } from "../unlinked/known-unlinked";
import { useChatMoves } from "../status/use-moves";
import { AddClientEmail } from "./add-email";
import { useMessengerDoneKey } from "./keys";
import { useDoneChat } from "./use-done";
import { shortcutsOn } from "@/hooks/use-shortcuts";
import { MessengerDraft } from "../draft";
import { AutopilotChatSwitch, AutopilotStateLine } from "../autopilot/chat-switch";
import type { useChatActions } from "../use-chat-actions";

type Actions = ReturnType<typeof useChatActions>;

function Message({ m, name, marked }: { m: MessengerConversationMessageDto; name: string; marked: boolean }) {
  const incoming = m.direction === "in";
  return (
    <ConversationMessage author={incoming ? name : "You"} bubbleClassName={cn(marked && "ring-2 ring-ring/40 ring-offset-2 ring-offset-background")} dateTime={m.at} direction={m.direction} hidden={m.hidden} id={`mm-${m.id}`} testId="messenger-conversation-message" time={formatTime(m.at)}>
      <ConversationText format={m.format} text={m.text.trim() || `(${m.kind})`} />
    </ConversationMessage>
  );
}

function ManualReply({
  chatId,
  isReply,
  onPrepare,
  prepareError,
  prepareLabel,
  preparePending,
  prepareAvailable,
  actionError,
  project,
}: {
  chatId: number;
  isReply: boolean;
  onPrepare: () => void;
  prepareError: unknown;
  prepareLabel: string;
  preparePending: boolean;
  prepareAvailable: boolean;
  actionError: string | null;
  project: string;
}) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const create = useManualMessengerDraft(project, chatId, () => {
    setValue("");
    setSaved(true);
  });
  const changeValue = (next: string) => {
    if (create.isError) create.reset();
    setValue(next);
    setSaved(false);
  };
  const submit = () => {
    const text = value.trim();
    if (!text || create.isPending) return;
    create.mutate(text);
  };
  const composerError = create.isError || prepareError || actionError ? sentence(create.error ?? prepareError ?? actionError) : null;
  const composerState = composerStateOf({ body: value, error: composerError, saving: create.isPending });
  return (
    <ConversationComposerEditor
      ariaLabel={isReply ? "Messenger reply composer" : "Messenger message composer"}
      disabled={create.isPending}
      footer={
        <ConversationComposerFooter feedback={composerError ? <p className="text-destructive-foreground text-sm" role="alert">{composerError}</p> : saved ? <p className="text-muted-foreground text-sm" role="status">Draft saved. It remains unsent.</p> : undefined}>
          {prepareAvailable && <ActionButton disabled={preparePending || create.isPending} onClick={onPrepare} size="s" variant="secondary">{prepareLabel}</ActionButton>}
          <ActionButton disabled={!value.trim() || create.isPending} onClick={submit} size="s" tooltip={{ content: "Save unsent draft", hotkey: "Meta/Ctrl + Enter" }} variant="primary">{create.isPending ? "Saving draft" : "Save draft"}</ActionButton>
          <ActionButton disabled={!value || create.isPending} onClick={() => changeValue("")} size="s" variant="quiet">Clear</ActionButton>
        </ConversationComposerFooter>
      }
      maxLength={MESSENGER_TEXT_MAX}
      notice={!isReply && <p className="text-muted-foreground text-xs" data-testid="new-thread-note">No reply is pending. This starts a new unsent draft.</p>}
      onChange={changeValue}
      onSubmit={submit}
      placeholder={isReply ? "Write your reply…" : "Write your message…"}
      state={composerState.state}
      testId="messenger-manual-reply"
      title={isReply ? "Write a reply" : "Write a message"}
      value={value}
    />
  );
}

export function MessengerConversationPane({ chatId, project, actions, onBack }: { chatId: number; project: string; actions: Actions; onBack: () => void }) {
  const historyRef = useRef<HTMLElement>(null);
  // The chat is the mutation's variable, so a pending or failed Prepare of another chat never shows on this one.
  const prepare = usePrepareReply(project);
  const preparing = prepare.isPending && prepare.variables === chatId;
  const prepareFailed = prepare.isError && prepare.variables === chatId ? prepare.error : null;
  const q = useMessengerConversation(project, chatId);
  const scrollState = useConversationScroll(historyRef, chatId);
  const data = q.data;
  const chat = data?.chat;
  const name = chat ? chatName(chat) : "Conversation";
  const pageId = chat?.client?.notion.state === "resolved" ? chat.client.notion.pageId ?? chat.client.notionPageId ?? notionPageIdOf(chat.client.notionUrl ?? null) : null;
  const notionState = chat ? notionIndicatorState(chat) : null;
  const restoreListFocus = () => {
    focusAgentRow(refOf("chat", chatId));
  };
  // P136 verdict 7c: a map node's sources, ringed in this chat ("YYYY-MM-DD <channel>" of this chat's channel).
  const [marked, setMarked] = useState<{ chatId: number; keys: string[]; label: string } | null>(null);
  const showSources = (refs: string[], label: string) => {
    const list = (data?.messages ?? []).map((m) => ({ key: String(m.id), at: m.at, channel: chat?.channel ?? "" }));
    setMarked({ chatId, keys: matchSources(refs, list), label });
  };
  // P141 U3: a known chat that is not linked says who the person is and offers Link, Create and Hide in its header.
  const moves = useChatMoves(project);
  const dialog = chat ? dialogOf(chat) : null;
  const [linking, setLinking] = useState<{ chatId: number; mode: "search" | "create" } | null>(null);
  const linkMode = linking?.chatId === chatId ? linking.mode : null;
  const stopLinking = () => setLinking(null);
  const who = chat && !chat.client ? identityLine(chat.identity) : null;
  // P143 N1: a linked chat is titled by its client; the number or @username is the subtitle.
  const handle = chat?.client ? handleLine(chat.identity) : null;
  // P143 D2: No reply needed while a reply is owed and no draft waits (a draft's own Skip covers that case).
  const doneChat = useDoneChat(project);
  const canDone = chat !== undefined && chat.owed && chat.draft === null;
  const markDone = canDone && chat ? () => doneChat.mark(chat.id, name) : null;
  useMessengerDoneKey({ enabled: shortcutsOn, done: doneChat.pending ? null : markDone });
  const doneWhy = chat ? doneLine(chat.done) : null;
  const marks = marked?.chatId === chatId ? { keys: marked.keys, label: marked.label, onClear: () => setMarked(null) } : null;
  const ringed = new Set(marks?.keys ?? []);
  const firstMark = marks?.keys[0] ?? null;
  useEffect(() => {
    if (!firstMark) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(`mm-${firstMark}`)?.scrollIntoView({ block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [firstMark]);
  const composer = chat && data ? chat.draft ? (
    <MessengerDraft actions={actions} d={chat.draft} embedded key={`draft:${chatId}:${chat.draft.id}`} name={name} project={project} />
  ) : (
    <ManualReply
      chatId={chatId}
      isReply={chat.owed}
      onPrepare={() => prepare.mutate(chatId)}
      prepareAvailable={chat.owed && chat.rules.replyMode !== "off" && chat.client !== null}
      prepareError={prepareFailed}
      prepareLabel={preparing ? "Preparing…" : "Prepare reply"}
      preparePending={preparing}
      project={project}
      actionError={actions.error}
      key={`manual:${chatId}`}
    />
  ) : undefined;
  let history: ReactNode;
  if (q.isPending) history = <ConversationHistoryState><Loading what="the conversation" /></ConversationHistoryState>;
  else if (q.isError && (!data || isNotFound(q.error))) {
    history = isNotFound(q.error) ? (
      <ConversationHistoryState flush><EmptyState action={<ActionButton onClick={onBack} size="s" variant="secondary">Back to chats</ActionButton>} title="Chat not found">The Hub no longer knows this chat (it was hidden, or its copy expired).</EmptyState></ConversationHistoryState>
    ) : (
      <ConversationHistoryState><LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the conversation" /></ConversationHistoryState>
    );
  } else if (data) {
    const { messages, earlier } = data;
    history = (
      <>
        {q.isFetching && <ConversationRefreshing />}
        {data.copy === "saved" && <ConversationHistorySummary>Showing the saved copy: Telegram did not answer in time.</ConversationHistorySummary>}
        {dialog && linkMode && (
          <ConversationHistoryNotice>
            {linkMode === "search" ? (
              <RecordSearch autoFocus onCancel={stopLinking} onLinked={(res) => { void moves.announce(res, dialog); stopLinking(); }} onPick={(rec) => moves.link.mutate({ ...dialog, rec }, { onSuccess: stopLinking })} project={project} r={dialog} />
            ) : (
              <CreateClient onDone={(res) => { void moves.announce(res, dialog); stopLinking(); }} project={project} r={dialog} />
            )}
          </ConversationHistoryNotice>
        )}
        {marks && <MapMarksNote marks={marks} />}
        {q.isError && <ConversationHistoryNotice><ConversationStaleNotice detail={sentence(q.error)} onRetry={() => void q.refetch()} retrying={q.isFetching} /></ConversationHistoryNotice>}
        {earlier > 0 && <ConversationHistorySummary>Earlier: {earlier} messages are not shown.</ConversationHistorySummary>}
        {messages.length === 0 ? <ConversationHistoryState flush><EmptyState title="No messages yet">{chat?.client ? "New messages from this linked chat will appear here." : "New messages from this chat will appear here. Link it to a client to keep its history."}</EmptyState></ConversationHistoryState> : <ConversationMessageList ariaLabel={`Messages with ${name}`}>{messages.reduce<ReactNode[]>((items, message, index) => {
          const previous = messages[index - 1];
          const currentDay = dayOf(message.at);
          // Decision 0049 point 5: a day that holds a message only the Mac's WhatsApp app supplied says so once, on its divider.
          const fromApp = messages.some((m) => m.source === "wa_app" && dayOf(m.at) === currentDay);
          if (!previous || dayOf(previous.at) !== currentDay) items.push(<ConversationDayDivider key={`day-${currentDay}`} label={fromApp ? `${formatDay(message.at)} · from the WhatsApp app on this Mac` : formatDay(message.at)} />);
          items.push(<Message key={message.id} m={message} marked={ringed.has(String(message.id))} name={name} />);
          return items;
        }, [])}</ConversationMessageList>}
      </>
    );
  } else {
    history = <ConversationHistoryState><Loading what="the conversation" /></ConversationHistoryState>;
  }
  history = <ConversationHistoryContent ariaBusy={q.isFetching} ariaLabel={`Conversation history with ${name}`} historyRef={historyRef}>{history}</ConversationHistoryContent>;
  return (
    <ConversationFrame
      ariaLabel={`Conversation with ${name}`}
      composer={composer}
      header={<ConversationHeader actions={dialog ? <UnlinkedHeaderButtons moves={moves} onMode={(mode) => setLinking({ chatId, mode })} project={project} r={dialog} /> : <>{chat?.done && chat.last?.direction === "in" && <ActionButton data-testid="chat-reopen" disabled={doneChat.pending} onClick={() => doneChat.reopen(chat.id)} size="s" tooltip="Back to Needs you" variant="quiet">Reopen</ActionButton>}{markDone && <ActionButton data-testid="chat-no-reply-needed" disabled={doneChat.pending} onClick={markDone} size="s" tooltip={{ content: "The chat leaves Needs you until they write again", hotkey: "D" }} variant="secondary">No reply needed</ActionButton>}<AutopilotChatSwitch chatId={chatId} compact project={project} /><ConversationHeaderActions contact={chat?.contact} notionPageId={pageId} /></>} back={<ConversationBackButton onClick={onBack} onRestoreFocus={restoreListFocus} />} subtitle={chat ? <ConversationHeaderFacts>{chat.client && <ClientMapLine onShowSources={showSources} subject={{ project, clientId: chat.client.id, name: chat.client.name || chat.client.email || "this client", email: chat.client.email, notionPageId: pageId }} />}<span>{CHANNEL_LABEL[chat.channel]}</span>{handle && <span data-testid="chat-handle">{handle}</span>}{!chat.client && <span>Not linked</span>}{who && <span>{who}</span>}<span>{chatStateLine(chat)}</span>{doneWhy && <span data-testid="chat-done-line">{doneWhy}</span>}{chat.client && <AutopilotStateLine chatId={chatId} project={project} />}{chat.client && !chat.client.email && <AddClientEmail chatId={chatId} name={chat.client.name} project={project} />}{chat.client?.email && <ConversationLabel className="min-w-0 max-w-[min(24rem,45vw)] truncate" value={chat.client.email} />}{notionState && <IntegrationStatus detail={notionIdentityLine(chat) ?? undefined} label="Notion" state={notionState} />}</ConversationHeaderFacts> : q.isPending ? "Loading conversation…" : "Conversation unavailable"} title={name} />}
      testId="messenger-conversation"
      dataAgentRef={refOf("chat", chat?.id ?? chatId)}
      historyActions={!scrollState.atLatest ? <ConversationScrollToLatest onClick={scrollState.scrollToLatest} /> : undefined}
    >
      {history}
    </ConversationFrame>
  );
}
