import { useState } from "react";
import type { HiddenDialogDto } from "@hub/contract/messengers";
import { EmptyState } from "@/components/state-views";
import { ago } from "@/lib/format";
import { ChannelIcon } from "../channel/channel-icon";
import { unnamedHiddenLine } from "../labels";
import { StatusMenu, type StatusAction } from "../status/status-menu";
import type { useChatMoves } from "../status/use-moves";
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
    <li aria-label={h.title} className="flex flex-col gap-2 py-3" data-hidden-chat={`${h.channel}:${h.chatId}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ChannelIcon channel={h.channel} />
        <span className="font-medium text-sm">{h.title}</span>
        <span className="text-muted-foreground text-xs">hidden {ago(h.hiddenAt, now)}</span>
        <div className="ms-auto">
          <StatusMenu disabled={unhide.isPending || moves.pending} name={h.title} onAction={on} s={{ state: "hidden", canLink: account !== null }} />
        </div>
      </div>
      {searching && account !== null && (
        <RecordSearch onCancel={() => setSearching(false)} onPick={(rec) => moves.link.mutate({ channel: h.channel, account, chatId: h.chatId, title: h.title, rec }, { onSuccess: () => setSearching(false) })} project={project} />
      )}
    </li>
  );
}

export function HiddenChats({ project, rows, unnamed, now, moves }: { project: string; rows: HiddenDialogDto[]; unnamed: number; now: number; moves: Moves }) {
  if (rows.length === 0 && unnamed === 0)
    return <EmptyState title="No hidden chats">Hide a chat when it is not a client: it leaves the list and never links by itself.</EmptyState>;
  return (
    <section className="flex flex-col gap-2">
      {rows.length > 0 && (
        <ul aria-label="Hidden chats" className="flex flex-col divide-y border-y">
          {rows.map((h) => (
            <HiddenRow h={h} key={`${h.channel}:${h.chatId}`} moves={moves} now={now} project={project} />
          ))}
        </ul>
      )}
      {unnamed > 0 && <p className="measure text-muted-foreground text-xs">{unnamedHiddenLine(unnamed)}</p>}
    </section>
  );
}
