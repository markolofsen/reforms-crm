import type { HiddenDialogDto } from "@hub/contract/messengers";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { EmptyState } from "@/components/state-views";
import { ago } from "@/lib/format";
import { CHANNEL_LABEL, unnamedHiddenLine } from "../labels";
import { useHide } from "./use-hide";

/**
 * Hidden (P84c): the chats the owner said are not clients. The store keeps only a keyed hash of each (`messenger_link_refusals`),
 * so a name is known only while the server's memory holds it (hidden in this run, or seen again since); the rest are one muted
 * count. Each named one has Unhide, which deletes the refusal and puts the chat back on To do when it is fresh.
 */
export function HiddenChats({ project, rows, unnamed, now }: { project: string; rows: HiddenDialogDto[]; unnamed: number; now: number }) {
  const { unhide } = useHide(project);
  if (rows.length === 0 && unnamed === 0)
    return <EmptyState title="No hidden chats">Hide a chat on To do when it is not a client: it leaves the list and never links by itself.</EmptyState>;
  return (
    <section className="flex flex-col gap-2">
      {rows.length > 0 && (
        <ul aria-label="Hidden chats" className="flex flex-col divide-y border-y">
          {rows.map((h) => (
            <li aria-label={h.title} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" data-hidden-chat={`${h.channel}:${h.chatId}`} key={`${h.channel}:${h.chatId}`}>
              <span className="font-medium text-sm">{h.title}</span>
              <Badge variant="outline">{CHANNEL_LABEL[h.channel]}</Badge>
              <span className="text-muted-foreground text-xs">hidden {ago(h.hiddenAt, now)}</span>
              <ActionButton className="ms-auto" disabled={unhide.isPending} onClick={() => unhide.mutate(h)} size="s" variant="secondary">
                Unhide<span className="sr-only"> {h.title}</span>
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      {unnamed > 0 && <p className="measure text-muted-foreground text-xs">{unnamedHiddenLine(unnamed)}</p>}
    </section>
  );
}
