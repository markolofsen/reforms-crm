import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";
import type { MessengerChannelFilter, MessengerView as View } from "@hub/contract/messenger-panel";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationList } from "@hub/ui/product/conversation";
import { ConversationEmptyState } from "@hub/ui/product/conversation-frame";
import { SearchField } from "@hub/ui/product/search-field";
import { Page } from "@hub/ui/product/page";
import { ListDetail, ListScrollArea } from "@hub/ui/product/list-detail";
import { ListFilterMenu, ListToolbar, ListToolbarRow } from "@hub/ui/product/list-toolbar";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, ListState, LoadFailed, Refreshing, StaleNote } from "@/components/state-views";
import { useSearch } from "@/hooks/use-search-state";
import { useDebounced } from "@/hooks/use-debounced";
import { usePaneMeasured, usePaneNarrow } from "@/hooks/use-pane";
import { useGo } from "@/hooks/use-go";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";
import { useClock } from "@/lib/clock";
import { dest } from "@/routes/paths";
import { MESSENGERS_SEARCH } from "@/routes/search";
import { ChatRow } from "./chat-row";
import { CHANNEL_FILTER_LABEL, emptyLine, VIEW_LABEL, VIEW_ORDER } from "./labels";
import { useTelegramUser } from "./settings/use-telegram";
import { useWhatsApp } from "./settings/whatsapp/use-whatsapp";
import { LinkChat } from "./status/link-chat";
import { useChatMoves } from "./status/use-moves";
import { channelOptions, effectiveChannel, hiddenRows, matchesHiddenSearch, matchesRecentSearch, notLinkedRows, unlinkedRows, viewCounts } from "./unlinked/chats-model";
import { HiddenChats } from "./unlinked/hidden-chats";
import { UnlinkedChats } from "./unlinked/unlinked-chats";
import { useChatActions } from "./use-chat-actions";
import { MessengerConversationPane } from "./conversation/pane";

/** The server keeps the unlinked chats in memory and a new one bumps no live topic: read again this often while the screen is open. */
const POLL_MS = 15_000;

/** The View menu (To do, Linked, Not linked, Hidden), each with its count (`admin-principles.md` rule 11). */
/** The View menu; its trigger is the list's title (P128 X4): "Messengers · To do 3", or the channel chosen in the sidebar, "WhatsApp · To do 1". */
function ViewMenu({ value, counts, onChange, where }: { value: View; counts: Record<View, number> | undefined; onChange: (v: string) => void; where: string }) {
  const count = (v: View) => counts?.[v];
  return <ListFilterMenu name="View" onChange={onChange} options={VIEW_ORDER.map((v) => ({ value: v, label: VIEW_LABEL[v], count: count(v) }))} tooltip="Filter chats by view" value={value} where={where} />;
}

/**
 * Messengers ▸ Chats (P71 M3, `/messengers`, `g m`; simplified by P84c on the owner's words of 2026-11-20): what the messengers owe.
 * One page for both channels, the channel chosen in the sidebar (P125 L5, `?channel=`), and the states of a chat in one View menu: To do (the linked
 * chats that wait, a draft or the client wrote last, then the fresh unlinked chats nobody decided on), Linked (every linked chat),
 * Not linked (P102: every unlinked chat the Hub remembers, of any age) and Hidden (the chats he said are not clients). Each row has
 * one state menu (P102); "Link a chat…" starts from a client. Rows stay compact and expose identity plus the latest state; the selected
 * conversation owns the full history, agent draft actions and owner-only visual Markdown composer. Mail drafts stay in Drafts. No status
 * sentence: its numbers are the View menu's.
 */
export function ChatsView({ project, filter, channel: asked, chatId = null }: { project: string; filter: View; channel: MessengerChannelFilter; chatId?: number | null }) {
  const go = useGo();
  const narrow = usePaneNarrow();
  const measured = usePaneMeasured();
  const [{ q: search }, setSearch] = useSearch(MESSENGERS_SEARCH);
  const now = useClock()();
  const tg = useTelegramUser();
  const wa = useWhatsApp();
  const telegram = tg.data?.accounts.some((a) => a.state === "running") ?? false;
  const whatsapp = wa.data?.accounts.some((a) => a.state === "running") ?? false;
  const options = channelOptions({ telegram, whatsapp });
  const channel = effectiveChannel(asked, options);
  useEffect(() => {
    if (!tg.isSuccess || !wa.isSuccess || asked === channel) return;
    setSearch({ channel });
  }, [asked, channel, setSearch, tg.isSuccess, wa.isSuccess]);
  const searchQuery = useDebounced(search.trim(), 200);
  const q = useQuery({ queryKey: keys.messengerChats(project, filter, channel, searchQuery), queryFn: () => messengersApi.chats(project, { filter, channel, q: searchQuery }), placeholderData: keepPreviousData });
  const al = useQuery({ queryKey: keys.autolink(project), queryFn: () => messengersApi.autolinkState(project), refetchInterval: POLL_MS, gcTime: 0, retry: false });
  const actions = useChatActions(project, chatId);
  const moves = useChatMoves(project, chatId);
  const [linking, setLinking] = useState(false);
  const accounts = [
    ...(tg.data?.accounts ?? []).filter((a) => a.state === "running").map((a) => ({ channel: "telegram_user" as const, account: a.account })),
    ...(wa.data?.accounts ?? []).filter((a) => a.state === "running").map((a) => ({ channel: "whatsapp" as const, account: a.account })),
  ].filter((a) => channel === "all" || (channel === "whatsapp") === (a.channel === "whatsapp"));
  const d = q.data;
  const st = al.data;
  const unlinked = unlinkedRows(st, channel).filter((row) => matchesRecentSearch(row, searchQuery));
  const notLinked = notLinkedRows(st, channel).filter((row) => matchesRecentSearch(row, searchQuery));
  const hidden = hiddenRows(st, channel).filter((row) => matchesHiddenSearch(row, searchQuery));
  const searchEmpty = search.trim() ? <EmptyState action={<ActionButton onClick={() => setSearch({ q: "" })} size="s" variant="secondary">Clear search</ActionButton>} compact title="No chats match your search">Try a name, username, email, chat ID or message text.</EmptyState> : null;
  const accountsLine = emptyLine({ telegram, whatsapp, enabled: st?.enabled ?? false, withIdentifier: st?.directory.withIdentifier ?? 0, directoryReady: st?.directory.state === "ready" });
  const linkedList =
    d && d.chats.length > 0 ? (
      <ConversationList ariaLabel="Chats">
        {d.chats.map((c) => (
          <ChatRow c={c} key={c.id} moves={moves} now={now} open={c.id === chatId} project={project} replace={chatId !== null} to={dest("messengers.conversation", { id: c.id }, { filter, channel, q: search })} />
        ))}
      </ConversationList>
    ) : null;
  const unlinkedBlock = st ? <UnlinkedChats active={st.unlinkedActive} freshDays={st.freshDays} moves={moves} noLinked={!linkedList && d?.counts.linked === 0} now={now} project={project} rows={unlinked} /> : null;
  const autolinkNeeded = filter === "unlinked" || filter === "hidden" || (filter !== "linked" && !linkedList);

  let body;
  if (q.isPending) body = <ListSkeleton label="Loading the chats" rows={3} />;
  else if (!d) body = <ListState><LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the chats" /></ListState>;
  else if (autolinkNeeded && !st && al.isPending) body = <ListSkeleton label="Loading chat decisions" rows={3} />;
  else if (autolinkNeeded && !st && al.isError) body = <ListState><LoadFailed error={al.error} onRetry={() => void al.refetch()} retrying={al.isFetching} what="chat decisions" /></ListState>;
  else if (filter === "unlinked")
    body =
      notLinked.length === 0 ? searchEmpty ?? (
        <EmptyState compact title="No unlinked chats">Every chat the Hub has seen since it started is linked or hidden. A chat that writes and matches no client shows here.</EmptyState>
      ) : st ? (
        <UnlinkedChats active={0} freshDays={null} moves={moves} noLinked={false} now={now} project={project} rows={notLinked} />
      ) : null;
  else if (filter === "hidden") body = hidden.length === 0 && searchEmpty ? searchEmpty : <HiddenChats moves={moves} now={now} project={project} rows={hidden} unnamed={channel === "all" && !searchQuery ? (st?.hiddenUnnamed ?? 0) : 0} />;
  else if (filter === "linked")
    body = linkedList ?? searchEmpty ?? (
      <EmptyState compact title="No linked chats yet">
        {accountsLine} The rules of each linked chat are on <AppLink to={dest("settings.messengers")}>Settings ▸ Messengers</AppLink>.
      </EmptyState>
    );
  else if (!linkedList && unlinked.length === 0)
    body = searchEmpty ?? (d.counts.linked === 0 ? (
        <EmptyState compact title="No linked chats yet">
          {accountsLine} The accounts and the rules of each linked chat are on <AppLink to={dest("settings.messengers")}>Settings ▸ Messengers</AppLink>.
        </EmptyState>
      ) : (
        <EmptyState action={<ActionButton onClick={() => setSearch({ filter: "linked" })} size="s" variant="secondary">Show linked chats</ActionButton>} compact title="Nothing to do">
          No draft to read, no chat where the client wrote last, and no new chat to decide on.
        </EmptyState>
      ));
  else
    body = (
      <>
        {/* With unlinked rows below, "no linked chats yet" is said in the unlinked rows' one line (P84c, P88). */}
        {linkedList}
        {unlinkedBlock}
      </>
    );
  useEffect(() => {
    // Routes rule 9: a narrow pane opens nothing, and the width is not known before the shell measures it (P127 divergence 2).
    if (measured && !narrow && chatId === null && !q.isFetching && d?.chats[0]) go(dest("messengers.conversation", { id: d.chats[0].id }, { filter, channel, q: search }), { replace: true });
  }, [channel, chatId, d?.chats, filter, go, measured, narrow, q.isFetching, search]);
  const list = (
    <ListScrollArea ariaBusy={Boolean(d && q.isFetching)}>
      <ListToolbar ariaLabel="Chat filters and actions">
        <ListToolbarRow>
          <ViewMenu counts={viewCounts(d?.counts, st, channel)} onChange={(v) => setSearch({ filter: v })} value={filter} where={channel === "all" ? "Messengers" : CHANNEL_FILTER_LABEL[channel]} />
          <div className="min-w-0 flex-1 @max-3xl:order-last @max-3xl:basis-full">
            <SearchField label="Search chats" onChange={(v) => setSearch({ q: v })} value={search} />
          </div>
          {accounts.length > 0 && (
            <ActionButton aria-expanded={linking} aria-label={linking ? "Close link a chat" : "Link a chat"} className="ms-auto" icon onClick={() => setLinking((v) => !v)} size="s" tooltip={linking ? "Close link a chat" : "Link a chat"} variant="secondary">
              <PlusIcon aria-hidden="true" />
            </ActionButton>
          )}
          {d && q.isFetching && <Refreshing />}
        </ListToolbarRow>
      </ListToolbar>
      {linking && <LinkChat accounts={accounts} moves={moves} onClose={() => setLinking(false)} project={project} />}
      {body}
      {actions.error && chatId === null && <ListState><p className="text-destructive-foreground text-sm" role="alert">{actions.error}</p></ListState>}
      {d && q.isError && <ListState><StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} /></ListState>}
      {al.isError && st && filter !== "linked" && <ListState><StaleNote error={al.error} onRetry={() => void al.refetch()} retrying={al.isFetching} /></ListState>}
    </ListScrollArea>
  );
  const detail = chatId === null ? <ConversationEmptyState subtitle="Choose a chat from the list"><EmptyState compact title="Nothing to open">Pick a person from the list.</EmptyState></ConversationEmptyState> : <MessengerConversationPane actions={actions} chatId={chatId} onBack={() => go(dest("messengers.page", { filter, channel, q: search }))} project={project} />;
  return <Page flush scroll={false}><ListDetail detail={detail} detailLabel="Conversation" list={list} listLabel="Chats" showDetail={chatId !== null} /></Page>;
}
