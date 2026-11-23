import { useState } from "react";
import type { HiddenDialogDto } from "@hub/contract/messengers";
import { EmptyState } from "@/components/state-views";
import { ago } from "@/lib/format";
import { ChannelIcon } from "../channel/channel-icon";
import { unnamedHiddenLine } from "../labels";
import { StatusMenu, type StatusAction } from "../status/status-menu";
import type { useChatMoves } from "../status/use-moves";
import { ConversationList, ConversationListIdentity, ConversationListItem } from "@hub/ui/product/conversation";
import { RecordSearch } from "./record-search";
import { useHide } from "./use-hide";

type Moves = ReturnType<typeof useChatMoves>;

/**
 * Hidden (P84c, P102): the chats the owner said are not clients. The store keeps only a keyed hash of each (`messenger_link_refusals`),
 * so a name is known only while the server's memory holds it (hidden in this run, or seen again since); the rest are one muted
 * count. Each named one has the state menu: Unhide, which deletes the refusal and puts the chat back in Not linked, or Link to a
 * client (a hidden chat can be linked: the link forgets the refusal).
 */
function HiddenRow({ project, h, now, moves }: { project: string; h: HiddenDialogDto; now: number; moves: Moves }) {
  const { unhide } = useHide(project);
  const [searching, setSearching] = useState(false);
  const account = h.account;
  const on = (a: StatusAction) => {
    if (a === "unhide") unhide.mutate(h);
    else if (a === "link") setSearching(true);
  };
  return (
    <ConversationListItem ariaLabel={h.title} className="flex flex-col gap-1.5 px-3 py-2" dataAttributes={{ "data-hidden-chat": `${h.channel}:${h.chatId}` }}>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <ConversationListIdentity leading={<ChannelIcon channel={h.channel} />} name={<span data-agent-label="">{h.title}</span>} />
          <span className="mt-0.5 block truncate text-muted-foreground text-xs">hidden {ago(h.hiddenAt, now)}</span>
        </div>
        <StatusMenu compact disabled={unhide.isPending || moves.pending} name={h.title} onAction={on} s={{ state: "hidden", canLink: account !== null }} />
      </div>
      {searching && account !== null && (
        <RecordSearch autoFocus onCancel={() => setSearching(false)} onPick={(rec) => moves.link.mutate({ channel: h.channel, account, chatId: h.chatId, title: h.title, rec }, { onSuccess: () => setSearching(false) })} project={project} />
      )}
    </ConversationListItem>
  );
}

export function HiddenChats({ project, rows, unnamed, now, moves }: { project: string; rows: HiddenDialogDto[]; unnamed: number; now: number; moves: Moves }) {
  if (rows.length === 0 && unnamed === 0)
    return <EmptyState compact title="No hidden chats">Hide a chat when it is not a client: it leaves the list and never links by itself.</EmptyState>;
  return (
    <section className="flex flex-col gap-2">
      {rows.length > 0 && (
        <ConversationList ariaLabel="Hidden chats">
          {rows.map((h) => (
            <HiddenRow h={h} key={`${h.channel}:${h.chatId}`} moves={moves} now={now} project={project} />
          ))}
        </ConversationList>
      )}
      {unnamed > 0 && <p className="measure text-muted-foreground text-xs">{unnamedHiddenLine(unnamed)}</p>}
    </section>
  );
}
