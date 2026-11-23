import { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon } from "lucide-react";
import type { MessengerChannelFilter, MessengerLinkFilter, MessengerView as View } from "@hub/contract/messenger-panel";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationEmptyState } from "@hub/ui/product/conversation-frame";
import { SearchField } from "@hub/ui/product/search-field";
import { Page } from "@hub/ui/product/page";
import { ListDetail, ListScrollArea } from "@hub/ui/product/list-detail";
import { ListFilterMenu, ListToolbar, ListToolbarRow } from "@hub/ui/product/list-toolbar";
import { EmptyState, ListState, Refreshing } from "@/components/state-views";
import { useSearch } from "@/hooks/use-search-state";
import { useDebounced } from "@/hooks/use-debounced";
import { usePaneMeasured, usePaneNarrow } from "@/hooks/use-pane";
import { useGo } from "@/hooks/use-go";
import { shortcutsOn } from "@/hooks/use-hotkeys";
import { focusRow, useListKeys } from "@/components/conversation/list/keys";
import { useClock } from "@/lib/clock";
import { useAutolinkState, useMessengerChats, useTelegramUser, useWhatsApp } from "@/lib/data/messengers";
import { dest } from "@/routes/paths";
import { MESSENGERS_SEARCH } from "@/routes/search";
import { CHANNEL_FILTER_LABEL, emptyLine, LINK_LABEL, LINK_ORDER, VIEW_LABEL, VIEW_ORDER } from "./labels";
import { LinkChat } from "./status/link-chat";
import { useChatMoves } from "./status/use-moves";
import { ChatsBody } from "./unlinked/chats-body";
import { channelOptions, effectiveChannel, linkCounts, viewCounts } from "./unlinked/chats-model";
import { useChatActions } from "./use-chat-actions";
import { MessengerConversationPane } from "./conversation/pane";

/** The View menu; its trigger is the list's title (P128 X4): "Messengers · Needs you 3", or the channel chosen in the sidebar, "WhatsApp · Needs you 1". */
function ViewMenu({ value, counts, onChange, where }: { value: View; counts: Record<View, number> | undefined; onChange: (v: string) => void; where: string }) {
  return <ListFilterMenu name="View" onChange={onChange} options={VIEW_ORDER.map((v) => ({ value: v, label: VIEW_LABEL[v], count: counts?.[v] }))} tooltip="Filter chats by view" value={value} where={where} />;
}

/** P123 U3b: the link state as a filter beside the view (Any link, Linked, Not linked, Hidden), each with its count. */
function LinkMenu({ value, counts, onChange }: { value: MessengerLinkFilter; counts: Record<MessengerLinkFilter, number> | undefined; onChange: (v: string) => void }) {
  return <ListFilterMenu name="Link" onChange={onChange} options={LINK_ORDER.map((v) => ({ value: v, label: LINK_LABEL[v], count: counts?.[v] }))} tooltip="Filter chats by link" value={value} />;
}

/**
 * Messengers ▸ Chats (P71 M3, `/messengers`, `g m`; P84c, P102, P123 U3b): what the messengers owe. One page for both channels,
 * the channel chosen in the sidebar (P125 L5, `?channel=`); Mail's three views in one View menu (Needs you, the default: the linked
 * chats that wait, then the fresh unlinked chats nobody decided on; Waiting: the linked chats where we wrote last; All) and the
 * link state as a filter beside it (`?link=`: Any link, Linked, Not linked, Hidden). Each row has one state menu (P102); "Link a
 * chat…" starts from a client. The list draws its reads' states through `ChatsBody`.
 */
export function ChatsView({ project, filter, link, channel: asked, chatId = null }: { project: string; filter: View; link: MessengerLinkFilter; channel: MessengerChannelFilter; chatId?: number | null }) {
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
  const q = useMessengerChats(project, { filter, link, channel, q: searchQuery }, { keep: true });
  const al = useAutolinkState(project);
  const actions = useChatActions(project, chatId);
  const moves = useChatMoves(project);
  const [linking, setLinking] = useState(false);
  const accounts = [
    ...(tg.data?.accounts ?? []).filter((a) => a.state === "running").map((a) => ({ channel: "telegram_user" as const, account: a.account })),
    ...(wa.data?.accounts ?? []).filter((a) => a.state === "running").map((a) => ({ channel: "whatsapp" as const, account: a.account })),
  ].filter((a) => channel === "all" || (channel === "whatsapp") === (a.channel === "whatsapp"));
  const d = q.data;
  const st = al.data;
  const searchEmpty = search.trim() ? <EmptyState action={<ActionButton onClick={() => setSearch({ q: "" })} size="s" variant="secondary">Clear search</ActionButton>} compact title="No chats match your search">Try a name, username, email, chat ID or message text.</EmptyState> : null;
  const accountsLine = emptyLine({ telegram, whatsapp, enabled: st?.enabled ?? false, withIdentifier: st?.directory.withIdentifier ?? 0, directoryReady: st?.directory.state === "ready" });
  useEffect(() => {
    // Routes rule 9: a narrow pane opens nothing, and the width is not known before the shell measures it (P127 divergence 2).
    if (measured && !narrow && chatId === null && !q.isFetching && d?.chats[0]) go(dest("messengers.conversation", { id: d.chats[0].id }, { filter, link, channel, q: search }), { replace: true });
  }, [channel, chatId, d?.chats, filter, go, link, measured, narrow, q.isFetching, search]);
  // P127 C2 (question 1, delegated: yes): Mail's list keys. J/K move between the linked chats (replacing the entry), Enter goes in,
  // Esc comes back, / searches. No selection keys: Messengers has no multi-select (question 4).
  const searchRef = useRef<HTMLInputElement>(null);
  const chatTo = useCallback((id: number) => dest("messengers.conversation", { id }, { filter, link, channel, q: search }), [channel, filter, link, search]);
  const openChat = useCallback(
    (id: number | null, focus = false) => {
      if (id === null) return;
      go(chatTo(id), { replace: chatId !== null });
      if (focus) focusRow(`chat:${id}`);
    },
    [chatId, chatTo, go],
  );
  useListKeys({
    enabled: shortcutsOn,
    ids: d?.chats.map((c) => c.id) ?? [],
    currentId: chatId,
    refOf: (id) => `chat:${id}`,
    go: openChat,
    back: narrow && chatId !== null ? () => go(dest("messengers.page", { filter, link, channel, q: search })) : null,
    focusSearch: () => searchRef.current?.focus(),
  });
  const list = (
    <ListScrollArea ariaBusy={Boolean(d && q.isFetching)}>
      <ListToolbar ariaLabel="Chat filters and actions">
        <ListToolbarRow>
          <ViewMenu counts={viewCounts(d?.counts, st, channel, link)} onChange={(v) => setSearch({ filter: v })} value={filter} where={channel === "all" ? "Messengers" : CHANNEL_FILTER_LABEL[channel]} />
          <LinkMenu counts={linkCounts(d?.counts, st, channel)} onChange={(v) => setSearch({ link: v })} value={link} />
          <div className="min-w-0 flex-1 @max-3xl:order-last @max-3xl:basis-full">
            <SearchField inputRef={searchRef} label="Search chats" onChange={(v) => setSearch({ q: v })} value={search} />
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
      <ChatsBody
        accountsLine={accountsLine}
        channel={channel}
        chatId={chatId}
        chats={q}
        chatTo={chatTo}
        link={link}
        memory={al}
        moves={moves}
        now={now}
        onView={(v) => setSearch({ filter: v })}
        project={project}
        searchEmpty={searchEmpty}
        searchQuery={searchQuery}
        view={filter}
      />
      {actions.error && chatId === null && <ListState><p className="text-destructive-foreground text-sm" role="alert">{actions.error}</p></ListState>}
    </ListScrollArea>
  );
  const detail = chatId === null ? <ConversationEmptyState subtitle="Choose a chat from the list"><EmptyState compact title="Nothing to open">Pick a person from the list.</EmptyState></ConversationEmptyState> : <MessengerConversationPane actions={actions} chatId={chatId} onBack={() => go(dest("messengers.page", { filter, link, channel, q: search }))} project={project} />;
  return <Page flush scroll={false}><ListDetail detail={detail} detailLabel="Conversation" list={list} listLabel="Chats" showDetail={chatId !== null} /></Page>;
}
