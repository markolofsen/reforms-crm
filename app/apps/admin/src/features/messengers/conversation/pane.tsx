"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { MESSENGER_TEXT_MAX } from "@hub/config/chat-rules";
import { composerStateOf } from "@hub/contract/composer";
import type { MessengerConversationMessageDto } from "@hub/contract/messenger-panel";
import { refOf } from "@hub/contract/focus";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationDayDivider, ConversationLabel, ConversationMessage, ConversationMessageList, ConversationText } from "@hub/ui/product/conversation";
import { ConversationBackButton, ConversationComposerFooter, ConversationFrame, ConversationHeader, ConversationHeaderFacts, ConversationHistoryContent, ConversationHistoryNotice, ConversationHistoryState, ConversationHistorySummary, ConversationRefreshing, ConversationScrollToLatest, ConversationStaleNotice } from "@hub/ui/product/conversation-frame";
import { ConversationComposerEditor } from "@hub/ui/product/composer-editor";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import { useConversationScroll } from "@hub/ui/product/conversation-scroll";
import { ConversationHeaderActions } from "@/components/conversation/header-actions";
import { EmptyState, LoadFailed, Loading } from "@/components/state-views";
import { notionPageIdOf } from "@/lib/notion";
import { keys, messengerMutationKeys } from "@/lib/cache/keys";
import { focusAgentRow } from "@/lib/focus";
import { messengersApi } from "@/lib/api/messengers/panel";
import { isNotFound, sentence } from "@/lib/api/client";
import { dayOf, formatDay, formatTime } from "@/lib/format";
import { CHANNEL_LABEL, chatName, chatStateLine, notionIdentityLine, notionIndicatorState } from "../labels";
import { DraftBlock } from "../draft-block";
import type { useChatActions } from "../use-chat-actions";

type Actions = ReturnType<typeof useChatActions>;

function Message({ m, name }: { m: MessengerConversationMessageDto; name: string }) {
  const incoming = m.direction === "in";
  return (
    <ConversationMessage author={incoming ? name : "You"} dateTime={m.at} direction={m.direction} hidden={m.hidden} testId="messenger-conversation-message" time={formatTime(m.at)}>
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
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const create = useMutation({
    mutationFn: (text: string) => messengersApi.createManualDraft(project, chatId, text),
    onSuccess: () => {
      setValue("");
      setSaved(true);
      return Promise.all(messengerMutationKeys(project, chatId).map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
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
  const qc = useQueryClient();
  const historyRef = useRef<HTMLElement>(null);
  // The chat is the mutation's variable, so a pending or failed Prepare of another chat never shows on this one.
  const prepare = useMutation({ mutationFn: (id: number) => messengersApi.prepareReply(project, id), onSuccess: (_reply, id) => Promise.all(messengerMutationKeys(project, id).map((queryKey) => qc.invalidateQueries({ queryKey }))) });
  const preparing = prepare.isPending && prepare.variables === chatId;
  const prepareFailed = prepare.isError && prepare.variables === chatId ? prepare.error : null;
  const q = useQuery({ queryKey: keys.messengerConversation(project, chatId), queryFn: () => messengersApi.conversation(project, chatId) });
  const scrollState = useConversationScroll(historyRef, chatId);
  const data = q.data;
  const chat = data?.chat;
  const name = chat ? chatName(chat) : "Conversation";
  const pageId = chat?.client?.notion.state === "resolved" ? chat.client.notion.pageId ?? chat.client.notionPageId ?? notionPageIdOf(chat.client.notionUrl ?? null) : null;
  const notionState = chat ? notionIndicatorState(chat) : null;
  const restoreListFocus = () => {
    focusAgentRow(refOf("chat", chatId));
  };
  const composer = chat && data ? chat.draft ? (
    <DraftBlock actions={actions} chatId={chatId} d={chat.draft} embedded key={`draft:${chatId}:${chat.draft.id}`} name={name} project={project} />
  ) : (
    <ManualReply
      chatId={chatId}
      isReply={chat.owed}
      onPrepare={() => prepare.mutate(chatId)}
      prepareAvailable={chat.owed && chat.rules.replyMode !== "off"}
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
      <ConversationHistoryState flush><EmptyState action={<ActionButton onClick={onBack} size="s" variant="secondary">Back to chats</ActionButton>} title="Chat not found">This conversation is no longer linked to this project.</EmptyState></ConversationHistoryState>
    ) : (
      <ConversationHistoryState><LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the conversation" /></ConversationHistoryState>
    );
  } else if (data) {
    const { messages, earlier } = data;
    history = (
      <>
        {q.isFetching && <ConversationRefreshing />}
        {q.isError && <ConversationHistoryNotice><ConversationStaleNotice detail={sentence(q.error)} onRetry={() => void q.refetch()} retrying={q.isFetching} /></ConversationHistoryNotice>}
        {earlier > 0 && <ConversationHistorySummary>Earlier: {earlier} messages are not shown.</ConversationHistorySummary>}
        {messages.length === 0 ? <ConversationHistoryState flush><EmptyState title="No messages yet">New messages from this linked chat will appear here.</EmptyState></ConversationHistoryState> : <ConversationMessageList ariaLabel={`Messages with ${name}`}>{messages.reduce<ReactNode[]>((items, message, index) => {
          const previous = messages[index - 1];
          const currentDay = dayOf(message.at);
          if (!previous || dayOf(previous.at) !== currentDay) items.push(<ConversationDayDivider key={`day-${currentDay}`} label={formatDay(message.at)} />);
          items.push(<Message key={message.id} m={message} name={name} />);
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
      header={<ConversationHeader actions={<ConversationHeaderActions contact={chat?.contact} notionPageId={pageId} />} back={<ConversationBackButton onClick={onBack} onRestoreFocus={restoreListFocus} />} subtitle={chat ? <ConversationHeaderFacts><span>{CHANNEL_LABEL[chat.channel]}</span><span>{chatStateLine(chat)}</span>{chat.client?.email && <ConversationLabel className="min-w-0 max-w-[min(24rem,45vw)] truncate" value={chat.client.email} />}{notionState && <IntegrationStatus detail={notionIdentityLine(chat) ?? undefined} label="Notion" state={notionState} />}</ConversationHeaderFacts> : q.isPending ? "Loading conversation…" : "Conversation unavailable"} title={name} />}
      testId="messenger-conversation"
      dataAgentRef={refOf("chat", chat?.id ?? chatId)}
      historyActions={!scrollState.atLatest ? <ConversationScrollToLatest onClick={scrollState.scrollToLatest} /> : undefined}
    >
      {history}
    </ConversationFrame>
  );
}
