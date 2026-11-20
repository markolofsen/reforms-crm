import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import type { MessengerChatsDto, MessengerView as View } from "@hub/contract/messenger-panel";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/page";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { SubNav } from "@/components/sub-nav";
import { useSearchState } from "@/hooks/use-search-state";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";
import { useClock } from "@/lib/clock";
import { paths } from "@/routes/paths";
import { ChatRow } from "./chat-row";
import { VIEW_LABEL, VIEW_ORDER } from "./labels";
import { useChatActions } from "./use-chat-actions";

/** The View menu (Waiting, All chats), each with its count from the server (`admin-principles.md` rule 11). */
function ViewMenu({ value, counts, onChange }: { value: View; counts: MessengerChatsDto["counts"] | undefined; onChange: (v: string) => void }) {
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
 * Messengers ▸ Chats (P71 M3, `/messengers`, `g m`): what the messengers owe. The linked chats, the waiting ones first, each with
 * the newest stored message and the agent's open draft (Send, Edit, Skip); no compose box (decision 0036 point 6). Reads only
 * `messenger_drafts` and the linked chats; Mail drafts stay in Drafts. No status sentence: its numbers are the View menu's.
 */
export function ChatsView({ project, filter }: { project: string; filter: View }) {
  const setFilter = useSearchState("filter")[1];
  const now = useClock()();
  const q = useQuery({ queryKey: keys.messengerChats(project, filter), queryFn: () => messengersApi.chats(project, filter), placeholderData: keepPreviousData });
  const actions = useChatActions(project);
  const d = q.data;
  const header = <ViewMenu counts={d?.counts} onChange={setFilter} value={filter} />;
  const body = q.isPending ? (
    <ListSkeleton label="Loading the chats" rows={3} />
  ) : !d ? (
    <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the chats" />
  ) : d.counts.all === 0 ? (
    <EmptyState title="No linked chats yet">
      Only the chats you link to a client reach the Hub. Link one on{" "}
      <AppLink to={paths.messengers.settings()}>Messengers ▸ Settings</AppLink>.
    </EmptyState>
  ) : d.chats.length === 0 ? (
    <EmptyState action={<ActionButton onClick={() => setFilter("all")} size="s" variant="secondary">Show all chats</ActionButton>} title="Nothing waits">
      No draft to read and no chat where the client wrote last.
    </EmptyState>
  ) : (
    <>
      <ul aria-label="Chats" className="flex flex-col divide-y border-y">
        {d.chats.map((c) => (
          <ChatRow actions={actions} c={c} key={c.id} now={now} project={project} />
        ))}
      </ul>
      {actions.error && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {actions.error}
        </p>
      )}
      {q.isError && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
    </>
  );
  return (
    <Page actions={header} nav={<SubNav section="messengers" />}>
      {body}
    </Page>
  );
}
