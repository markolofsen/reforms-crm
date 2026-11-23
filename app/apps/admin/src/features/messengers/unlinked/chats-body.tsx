"use client";

import type { ReactNode } from "react";
import type { MessengerChannelFilter, MessengerChatsDto, MessengerLinkFilter, MessengerView } from "@hub/contract/messenger-panel";
import type { AutolinkStateDto } from "@hub/contract/messengers";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationList } from "@hub/ui/product/conversation";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, ListState, QueryView, type ViewQuery } from "@/components/state-views";
import { dest, type Dest } from "@/routes/paths";
import { ChatRow } from "../chat-row";
import type { useChatMoves } from "../status/use-moves";
import { foldOlder, hiddenRows, matchesHiddenSearch, matchesRecentSearch, NOT_LINKED_DAYS, notLinkedRows, unlinkedRows } from "./chats-model";
import { HiddenChats } from "./hidden-chats";
import { ProposedHides } from "./proposed-hides";
import { UnlinkedChats } from "./unlinked-chats";

type Moves = ReturnType<typeof useChatMoves>;

export type ChatsBodyProps = {
  project: string;
  view: MessengerView;
  link: MessengerLinkFilter;
  channel: MessengerChannelFilter;
  chatId: number | null;
  now: number;
  moves: Moves;
  /** The debounced search the lists match. */
  searchQuery: string;
  /** "No chats match your search" with Clear search, or null without a search. */
  searchEmpty: ReactNode;
  /** The accounts' one line for an empty linked list. */
  accountsLine: string;
  chatTo: (id: number) => Dest;
  onView: (view: MessengerView) => void;
  /** The autolink's memory (unlinked and hidden chats): its query, read only when the link state needs it. */
  memory: ViewQuery<AutolinkStateDto>;
};

/**
 * Messengers' list under a view and a link state (P123 U3b, Mail's three views; the link state a filter). The linked chats are the
 * server's, already filtered by the view; the unlinked and hidden ones are the autolink's memory. Each read draws its states
 * through `QueryView` (state rule 5): the chats first, then the memory when the link state lists from it.
 */
export function ChatsBody(p: ChatsBodyProps & { chats: ViewQuery<MessengerChatsDto> }) {
  const listsMemory = p.link === "unlinked" || p.link === "hidden" || (p.link === "any" && p.view !== "waiting");
  return (
    <QueryView frame={(note) => <ListState>{note}</ListState>} loading={<ListSkeleton label="Loading the chats" rows={3} />} query={p.chats} what="the chats">
      {(d) =>
        listsMemory ? (
          <QueryView frame={(note) => <ListState>{note}</ListState>} loading={<ListSkeleton label="Loading chat decisions" rows={3} />} query={p.memory} what="chat decisions">
            {(st) => <Lists {...p} d={d} st={st} />}
          </QueryView>
        ) : (
          <Lists {...p} d={d} st={undefined} />
        )
      }
    </QueryView>
  );
}

function Lists(p: ChatsBodyProps & { d: MessengerChatsDto; st: AutolinkStateDto | undefined }) {
  const { d, st, view, link, channel, now, moves, project, searchQuery } = p;
  const showAll = <ActionButton onClick={() => p.onView("all")} size="s" variant="secondary">Show all</ActionButton>;
  if (link === "hidden") {
    if (view !== "all") return <EmptyState action={showAll} compact title="Hidden chats need nothing">A chat you hid is not a client: it waits for nobody.</EmptyState>;
    const hidden = hiddenRows(st, channel).filter((row) => matchesHiddenSearch(row, searchQuery));
    return hidden.length === 0 && p.searchEmpty ? p.searchEmpty : <HiddenChats moves={moves} now={now} project={project} rows={hidden} unnamed={channel === "all" && !searchQuery ? (st?.hiddenUnnamed ?? 0) : 0} />;
  }
  const linkedList =
    link !== "unlinked" && d.chats.length > 0 ? (
      <ConversationList ariaLabel="Chats">
        {d.chats.map((c) => (
          <ChatRow c={c} key={c.id} moves={moves} now={now} open={c.id === p.chatId} project={project} replace={p.chatId !== null} to={p.chatTo(c.id)} />
        ))}
      </ConversationList>
    ) : null;
  const unlinked = link === "linked" || view === "waiting" ? null : <UnlinkedPart {...p} linkedShown={linkedList !== null} st={st} />;
  if (linkedList === null && unlinked === null) return p.searchEmpty ?? <NothingHere {...p} showAll={showAll} />;
  return (
    <>
      {/* With unlinked rows below, "no linked chats yet" is said in the unlinked rows' one line (P84c, P88). */}
      {linkedList}
      {unlinked}
    </>
  );
}

/** The unlinked chats of a view: Needs you shows the fresh undecided ones; All every remembered one, the last 14 days and one line for the older (P128 X5). */
function UnlinkedPart(p: ChatsBodyProps & { d: MessengerChatsDto; st: AutolinkStateDto | undefined; linkedShown: boolean }) {
  const { st, channel, now, moves, project, searchQuery } = p;
  if (!st) return null;
  // P128 X5: the agent's proposed hides, said once above the chats they name, on this channel only.
  const proposed = <ProposedHides project={project} proposals={st.proposals.filter((x) => channel === "all" || (channel === "whatsapp") === (x.channel === "whatsapp"))} />;
  if (p.view === "needs_you") {
    const fresh = unlinkedRows(st, channel).filter((row) => matchesRecentSearch(row, searchQuery));
    if (fresh.length === 0) return null;
    return (
      <>
        {proposed}
        <UnlinkedChats freshDays={st.freshDays} moves={moves} noLinked={!p.linkedShown && p.d.counts.all === 0} now={now} project={project} rows={fresh} />
      </>
    );
  }
  const all = notLinkedRows(st, channel).filter((row) => matchesRecentSearch(row, searchQuery));
  const { shown, older } = foldOlder(all, now, searchQuery !== "");
  if (shown.length === 0 && older === 0) return null;
  return (
    <>
      {proposed}
      {shown.length > 0 && <UnlinkedChats freshDays={searchQuery !== "" ? null : NOT_LINKED_DAYS} moves={moves} noLinked={false} now={now} project={project} rows={shown} />}
      {older > 0 && (
        <p className="px-3 py-2 text-muted-foreground text-sm" data-testid="not-linked-older">
          {shown.length > 0 ? "and " : ""}
          {older} older, untouched. Search finds them.
        </p>
      )}
    </>
  );
}

/** The empty list of a view and link state, in one sentence, with the way out. */
function NothingHere(p: ChatsBodyProps & { d: MessengerChatsDto; showAll: ReactNode }) {
  if (p.link === "unlinked")
    return p.view === "waiting" ? (
      <EmptyState action={p.showAll} compact title="Unlinked chats wait for nobody">A chat that is not linked has no reply of ours to wait on.</EmptyState>
    ) : (
      <EmptyState compact title="No unlinked chats">Every chat the Hub has seen since it started is linked or hidden. A chat that writes and matches no client shows here.</EmptyState>
    );
  if (p.d.counts.all === 0)
    return (
      <EmptyState compact title="No linked chats yet">
        {p.accountsLine} The accounts and the rules of each linked chat are on <AppLink to={dest("settings.messengers")}>Settings ▸ Messengers</AppLink>.
      </EmptyState>
    );
  if (p.view === "waiting")
    return (
      <EmptyState action={p.showAll} compact title="Nobody to wait for">
        No linked chat where you wrote last.
      </EmptyState>
    );
  return (
    <EmptyState action={p.showAll} compact title="Nothing to do">
      No draft to read, no chat where the client wrote last, and no new chat to decide on.
    </EmptyState>
  );
}
