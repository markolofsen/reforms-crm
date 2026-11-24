import { useEffect, useRef, type ReactNode } from "react";
import type { ConversationMailDto, ConversationMessageDto, ConversationThreadDto } from "@hub/contract/conversations";
import { refOf } from "@hub/contract/focus";
import { cn } from "@hub/ui/cn";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationDayDivider, ConversationLabel, ConversationMessage, ConversationMessageList, ConversationText } from "@hub/ui/product/conversation";
import { ConversationHistoryContent, ConversationHistoryNotice, ConversationHistoryState, ConversationHistorySummary, ConversationRefreshing, ConversationStaleNotice } from "@hub/ui/product/conversation/frame";
import { useConversationScroll, type ConversationScrollState } from "@hub/ui/product/conversation/scroll";
import { LoadFailed, Loading } from "@/components/state-views";
import { MapMarksNote, type MapMarks } from "@/components/conversation/client-map-view";
import { useConversationMail, useConversationText } from "@/lib/data/conversations";
import { sentence } from "@/lib/api/client";
import { dayOf, formatDay, formatTime, plural } from "@/lib/format";

/** One message's own words, read from Mail (decision 0013: never stored; the server keeps it in memory). */
function Body({ project, clientId, m }: { project: string; clientId: number; m: ConversationMessageDto }) {
  const q = useConversationText(project, clientId, m.messageId);
  if (q.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-1" data-testid="message-text">
        {m.preview.trim() ? <ConversationText format="plain" text={m.preview} /> : <p className="text-muted-foreground text-sm">Loading message…</p>}
      </div>
    );
  }
  const { text = null, note = null } = q.data ?? {};
  return (
    <div className="flex flex-col gap-1" data-testid="message-text">
      {text !== null ? <ConversationText format="plain" text={text} /> : (
        <>
          <p className="measure whitespace-pre-wrap break-words text-sm text-muted-foreground">{m.preview || note || (q.isError ? "Mail could not show this message." : "Mail did not show the text.")}</p>
          {q.isError && <ActionButton disabled={q.isFetching} onClick={() => void q.refetch()} size="s" variant="quiet">{q.isFetching ? "Trying again…" : "Try again"}</ActionButton>}
        </>
      )}
    </div>
  );
}

/** One message with its body visible, so the conversation reads like a continuous mail thread. `pointed`: `?m=` or a map node's source (P136). */
function Message({ project, clientId, m, name, pointed }: { project: string; clientId: number; m: ConversationMessageDto; name: string; pointed: boolean }) {
  const who = m.ours ? "You" : name.split(" ")[0] || name;
  return (
    <ConversationMessage author={who} bubbleClassName={cn(pointed && "ring-2 ring-ring/40 ring-offset-2 ring-offset-background")} dateTime={m.date} direction={m.ours ? "out" : "in"} focusRef={m.draftId !== null ? refOf("draft", m.draftId) : undefined} id={`m-${m.messageId}`} testId="history-message" time={formatTime(m.date)}>
      <Body clientId={clientId} m={m} project={project} />
    </ConversationMessage>
  );
}

/** A thread's divider (verdict 4): its subject, our brand there and the From of our side, so a client of two products reads right. */
function Divider({ t }: { t: ConversationThreadDto }) {
  return (
    <h3 className="flex min-w-0 items-center gap-2 px-4 pt-3 pb-1 text-muted-foreground text-xs lg:px-6" data-testid="thread-divider">
      <span aria-hidden="true" className="h-px w-3 shrink-0 bg-border" />
      <ConversationLabel className="min-w-0 truncate font-medium text-foreground" value={t.subject || "(no subject)"} />
      {t.brand && <><span aria-hidden="true">·</span><span className="shrink-0">{t.brand}</span></>}
      {t.ourFrom && <><span aria-hidden="true">·</span><ConversationLabel className="min-w-0 truncate" value={t.ourFrom} /></>}
      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
    </h3>
  );
}

function ThreadMessages({ clientId, messages, name, pointed, marked, project, subject }: { clientId: number; messages: ConversationMessageDto[]; name: string; pointed: string | null; marked: ReadonlySet<string>; project: string; subject: string }) {
  return (
    <ConversationMessageList ariaLabel={`Messages in ${subject || "this thread"}`} className="py-0">
      {messages.reduce<ReactNode[]>((items, message, index) => {
        const previous = messages[index - 1];
        const currentDay = dayOf(message.date);
        if (previous && dayOf(previous.date) !== currentDay) items.push(<ConversationDayDivider key={`day-${currentDay}`} label={formatDay(message.date)} />);
        items.push(<Message clientId={clientId} key={message.messageId} m={message} name={name} pointed={message.messageId === pointed || marked.has(message.messageId)} project={project} />);
        return items;
      }, [])}
    </ConversationMessageList>
  );
}

function Threads({ project, clientId, name, data, pointed, marked }: { project: string; clientId: number; name: string; data: ConversationMailDto; pointed: string | null; marked: ReadonlySet<string> }) {
  const all = data.threads.flatMap((t) => t.messages);
  if (all.length === 0) return <ConversationHistoryState><p className="text-center text-muted-foreground text-sm">No mail with this address yet{data.note ? `: ${data.note}` : "."}</p></ConversationHistoryState>;
  return (
    <>
      {data.earlier > 0 && <ConversationHistorySummary>Earlier: {plural(data.earlier, "message")} not shown; Open in Mail has them.</ConversationHistorySummary>}
      {data.threads.map((t) => (
        <section aria-label={t.subject || "(no subject)"} key={t.key}>
          <Divider t={t} />
          <ThreadMessages clientId={clientId} marked={marked} messages={t.messages} name={name} pointed={pointed} project={project} subject={t.subject} />
        </section>
      ))}
    </>
  );
}

/**
 * The whole correspondence with one person (P99 verdict 4), the newest-active thread last (P140), read from Mail when the conversation opens (the
 * spike's AppleScript read, about a second) and never stored. When Mail cannot be read the Hub's own rows show, with the reason.
 */
export function History({ project, clientId, name, onNote, onScrollState, onSourceMessageId, pointed, marks }: { project: string; clientId: number; name: string; onNote?: (note: string | null) => void; onScrollState?: (state: ConversationScrollState) => void; onSourceMessageId?: (messageId: string | null) => void; pointed: string | null; marks?: MapMarks | null }) {
  const q = useConversationMail(project, clientId);
  const historyRef = useRef<HTMLElement>(null);
  const lastScrolledPointed = useRef<string | null | undefined>(undefined);
  const scrollState = useConversationScroll(historyRef, `${clientId}:${pointed ?? ""}`, pointed === null);
  useEffect(() => {
    onScrollState?.(scrollState);
  }, [onScrollState, scrollState]);
  useEffect(() => {
    onNote?.(q.data?.source === "hub" && q.data.note ? q.data.note : null);
  }, [onNote, q.data]);
  useEffect(() => {
    if (!q.data || q.data.source !== "mail") {
      onSourceMessageId?.(null);
      return;
    }
    const messages = q.data.threads.flatMap((thread) => thread.messages);
    const sourceMessage = [...messages].reverse().find((message) => !message.ours);
    onSourceMessageId?.(sourceMessage?.messageId ?? null);
  }, [onSourceMessageId, q.data]);
  useEffect(() => {
    if (!q.data || lastScrolledPointed.current === pointed || !historyRef.current) return;
    const scroll = historyRef.current.closest<HTMLElement>('[data-pane="history"]');
    if (!scroll) return;
    lastScrolledPointed.current = pointed;
    const frame = window.requestAnimationFrame(() => {
      const target = pointed ? document.getElementById(`m-${pointed}`) : null;
      target?.scrollIntoView({ block: "center" });
      if (!target) scroll.scrollTop = scroll.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pointed, q.data]);
  const marked = new Set(marks?.keys ?? []);
  const firstMark = marks?.keys[0] ?? null;
  useEffect(() => {
    if (!firstMark) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(`m-${firstMark}`)?.scrollIntoView({ block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [firstMark]);
  return (
    <ConversationHistoryContent ariaBusy={q.isFetching} ariaLabel="Conversation" dataSource={q.data?.source} historyRef={historyRef} testId="conversation-history">
      {marks && <MapMarksNote marks={marks} />}
      {q.isPending ? (
        <ConversationHistoryState><Loading what="the conversation from Mail" /></ConversationHistoryState>
      ) : !q.data ? (
        <ConversationHistoryState><LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the conversation" /></ConversationHistoryState>
      ) : (
        <>
          {q.isFetching && <ConversationRefreshing />}
          {q.isError && <ConversationHistoryNotice><ConversationStaleNotice detail={sentence(q.error)} onRetry={() => void q.refetch()} retrying={q.isFetching} /></ConversationHistoryNotice>}
          <Threads clientId={clientId} data={q.data} marked={marked} name={name} pointed={pointed} project={project} />
        </>
      )}
    </ConversationHistoryContent>
  );
}

