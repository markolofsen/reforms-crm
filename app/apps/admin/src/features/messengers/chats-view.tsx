import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { MessengerChannelFilter, MessengerView as View } from "@hub/contract/messenger-panel";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/page";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { SubNav } from "@/components/sub-nav";
import { useSearchState } from "@/hooks/use-search-state";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";
import { useClock } from "@/lib/clock";
import { paths } from "@/routes/paths";
import { ChatRow } from "./chat-row";
import { emptyLine, VIEW_LABEL, VIEW_ORDER } from "./labels";
import { useTelegramUser } from "./settings/use-telegram";
import { useWhatsApp } from "./settings/whatsapp/use-whatsapp";
import { ChannelFilter } from "./channel/channel-filter";
import { LinkChat } from "./status/link-chat";
import { useChatMoves } from "./status/use-moves";
import { channelOptions, effectiveChannel, hiddenRows, notLinkedRows, unlinkedRows, viewCounts } from "./unlinked/chats-model";
import { HiddenChats } from "./unlinked/hidden-chats";
import { UnlinkedChats } from "./unlinked/unlinked-chats";
import { useChatActions } from "./use-chat-actions";

/** The server keeps the unlinked chats in memory and a new one bumps no live topic: read again this often while the screen is open. */
const POLL_MS = 15_000;

/** The View menu (To do, Linked, Not linked, Hidden), each with its count (`admin-principles.md` rule 11). */
function ViewMenu({ value, counts, onChange }: { value: View; counts: Record<View, number> | undefined; onChange: (v: string) => void }) {
  const count = (v: View) => counts?.[v] ?? "-";
  return (
    <Menu>
      <MenuTrigger render={<ActionButton size="m" variant="secondary" />}>
        <span className="sr-only">View: </span>
        {VIEW_LABEL[value]}
        <span className="font-normal tabular-nums">{count(value)}</span>
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup onValueChange={(v) => onChange(String(v))} value={value}>
          {VIEW_ORDER.map((v) => (
            <MenuRadioItem key={v} value={v}>
              {VIEW_LABEL[v]} <span className="ms-auto ps-3 text-muted-foreground tabular-nums">{count(v)}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * Messengers ▸ Chats (P71 M3, `/messengers`, `g m`; simplified by P84c on the owner's words of 2026-11-20): what the messengers owe.
 * One page for both channels, the channel a filter (`?channel=`), and the states of a chat in one View menu: To do (the linked
 * chats that wait, a draft or the client wrote last, then the fresh unlinked chats nobody decided on), Linked (every linked chat),
 * Not linked (P102: every unlinked chat the Hub remembers, of any age) and Hidden (the chats he said are not clients). Each row has
 * one state menu (P102); "Link a chat…" starts from a client. A linked row has the newest stored message and the agent's open draft
 * (Send, Edit, Skip); no compose box (decision 0036 point 6). Mail drafts stay in Drafts. No status sentence: its numbers are the View menu's.
 */
export function ChatsView({ project, filter, channel: asked }: { project: string; filter: View; channel: MessengerChannelFilter }) {
  const setFilter = useSearchState("filter")[1];
  const setChannel = useSearchState("channel")[1];
  const now = useClock()();
  const tg = useTelegramUser();
  const wa = useWhatsApp();
  const telegram = tg.data?.accounts.some((a) => a.state === "running") ?? false;
  const whatsapp = wa.data?.accounts.some((a) => a.state === "running") ?? false;
  const options = channelOptions({ telegram, whatsapp });
  const channel = effectiveChannel(asked, options);
  const q = useQuery({ queryKey: keys.messengerChats(project, `${filter}:${channel}`), queryFn: () => messengersApi.chats(project, filter, channel), placeholderData: keepPreviousData });
  const al = useQuery({ queryKey: keys.autolink(project), queryFn: () => messengersApi.autolinkState(project), refetchInterval: POLL_MS, gcTime: 0, retry: false });
  const actions = useChatActions(project);
  const moves = useChatMoves(project);
  const [linking, setLinking] = useState(false);
  const accounts = [
    ...(tg.data?.accounts ?? []).filter((a) => a.state === "running").map((a) => ({ channel: "telegram_user" as const, account: a.account })),
    ...(wa.data?.accounts ?? []).filter((a) => a.state === "running").map((a) => ({ channel: "whatsapp" as const, account: a.account })),
  ].filter((a) => channel === "all" || (channel === "whatsapp") === (a.channel === "whatsapp"));
  const d = q.data;
  const st = al.data;
  const unlinked = unlinkedRows(st, channel);
  const header = (
    <>
      {options.length > 0 && <ChannelFilter onChange={setChannel} options={options} value={channel} />}
      {accounts.length > 0 && (
        <ActionButton aria-expanded={linking} onClick={() => setLinking((v) => !v)} size="m" variant="secondary">
          Link a chat…
        </ActionButton>
      )}
      <ViewMenu counts={viewCounts(d?.counts, st, channel)} onChange={setFilter} value={filter} />
    </>
  );
  const accountsLine = emptyLine({ telegram, whatsapp, enabled: st?.enabled ?? false, withIdentifier: st?.directory.withIdentifier ?? 0, directoryReady: st?.directory.state === "ready" });
  const linkedList =
    d && d.chats.length > 0 ? (
      <ul aria-label="Chats" className="flex flex-col divide-y border-y">
        {d.chats.map((c) => (
          <ChatRow actions={actions} c={c} key={c.id} moves={moves} now={now} project={project} />
        ))}
      </ul>
    ) : null;
  const unlinkedBlock = st ? <UnlinkedChats active={st.unlinkedActive} freshDays={st.freshDays} moves={moves} noLinked={!linkedList && d?.counts.linked === 0} now={now} project={project} rows={unlinked} /> : null;

  let body;
  if (q.isPending) body = <ListSkeleton label="Loading the chats" rows={3} />;
  else if (!d) body = <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the chats" />;
  else if (filter === "unlinked")
    body =
      st && notLinkedRows(st, channel).length === 0 ? (
        <EmptyState title="No unlinked chats">Every chat the Hub has seen since it started is linked or hidden. A chat that writes and matches no client shows here.</EmptyState>
      ) : st ? (
        <UnlinkedChats active={0} freshDays={null} moves={moves} noLinked={false} now={now} project={project} rows={notLinkedRows(st, channel)} />
      ) : null;
  else if (filter === "hidden") body = <HiddenChats moves={moves} now={now} project={project} rows={hiddenRows(st, channel)} unnamed={channel === "all" ? (st?.hiddenUnnamed ?? 0) : 0} />;
  else if (filter === "linked")
    body = linkedList ?? (
      <EmptyState title="No linked chats yet">
        {accountsLine} The rules of each linked chat are on <AppLink to={paths.messengers.settings()}>Messengers ▸ Settings</AppLink>.
      </EmptyState>
    );
  else if (!linkedList && unlinked.length === 0)
    body =
      d.counts.linked === 0 ? (
        <EmptyState title="No linked chats yet">
          {accountsLine} The accounts and the rules of each linked chat are on <AppLink to={paths.messengers.settings()}>Messengers ▸ Settings</AppLink>.
        </EmptyState>
      ) : (
        <EmptyState action={<ActionButton onClick={() => setFilter("linked")} size="s" variant="secondary">Show linked chats</ActionButton>} title="Nothing to do">
          No draft to read, no chat where the client wrote last, and no new chat to decide on.
        </EmptyState>
      );
  else
    body = (
      <>
        {/* With unlinked rows below, "no linked chats yet" is said in the unlinked rows' one line (P84c, P88). */}
        {linkedList}
        {unlinkedBlock}
      </>
    );
  return (
    <Page actions={header} nav={<SubNav section="messengers" />}>
      {linking && <LinkChat accounts={accounts} moves={moves} onClose={() => setLinking(false)} project={project} />}
      {body}
      {actions.error && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {actions.error}
        </p>
      )}
      {d && q.isError && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
      {al.isError && filter !== "linked" && <p className="text-muted-foreground text-xs">{sentence(al.error)}</p>}
    </Page>
  );
}
