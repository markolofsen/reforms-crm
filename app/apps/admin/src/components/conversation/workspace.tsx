import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/shell/page";
import { ListDetail, ListScrollArea } from "@hub/ui/product/list/detail";
import { shortcutsOn } from "@/hooks/use-shortcuts";
import { usePaneMeasured, usePaneNarrow } from "@/hooks/use-pane";
import type { Channel, ChannelSlots } from "./adapter";
import { useListKeys } from "./list/keys";
import { useOpen } from "./list/use-list";

type Props = ChannelSlots & {
  channel: Channel;
  /** The conversation the address names (null: the bare list). */
  asked: number | null;
  /** The address names one whose id is still being asked (Mail's email key): no auto-open, so the first row cannot replace it. */
  pending?: boolean;
  /** The list is refetching behind its rows (the list column says so to assistive tech). */
  busy: boolean;
  /** `/` focuses it. */
  searchRef: RefObject<HTMLInputElement | null>;
  /** Above the detail: a notice of the channel's last move (Mail's "Copied…"), shown with a lead's card too. */
  notice?: ReactNode;
};

/**
 * The one conversation workspace (P127 C2, V5): Mail and Messengers draw it with their channel adapter. It owns the list column
 * (toolbar, the rows' slots, one scroll), the pane (the open conversation, a lead's card, or the idle state), opening and leaving
 * a conversation (`useOpen`: push, replace, the auto-open of a wide pane), the list keys (J/K, Enter, Esc, /; X and Shift A where
 * the channel selects) and the phone's Back. Each channel adds its own action keys and draws its own draft block in `pane`.
 */
export function ConversationWorkspace({ channel, asked, pending = false, busy, searchRef, notice, toolbar, listTop, rows, body, listBottom, aside }: Props) {
  const narrow = usePaneNarrow();
  const measured = usePaneMeasured();
  const asideOpen = aside?.open ?? false;
  const { shown, present, open, back } = useOpen(channel, { asked, narrow, measured, still: Boolean(body) || asideOpen || pending });
  useListKeys({
    enabled: shortcutsOn,
    ids: channel.ids,
    currentId: shown,
    refOf: channel.refOf,
    go: open,
    back: narrow && present ? back : null,
    focusSearch: () => searchRef.current?.focus(),
    selection: channel.selection,
  });

  const list = (
    // P98 item 2: every block of the scrolling list keeps its own height; a `min-h-*` on a child would else let it shrink under its content and paint over the next one.
    <ListScrollArea ariaBusy={busy}>
      {toolbar}
      {listTop}
      {body ?? rows}
      {listBottom}
    </ListScrollArea>
  );
  const detail = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-pane="detail">
      {narrow && asideOpen && (
        <div className="border-b p-2">
          <ActionButton onClick={back} size="m" variant="quiet">
            <ArrowLeftIcon aria-hidden="true" />
            {channel.noun.back}
          </ActionButton>
        </div>
      )}
      {asideOpen && notice}
      {aside?.open ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]" data-pane="aside">
          {aside.node}
        </div>
      ) : shown !== null ? (
        channel.pane(shown, back)
      ) : (
        channel.idle
      )}
    </div>
  );
  return (
    <Page flush scroll={false}>
      <ListDetail detail={detail} detailLabel={asideOpen ? (aside?.label ?? channel.noun.detail) : channel.noun.detail} list={list} listLabel={channel.noun.list} showDetail={asideOpen || present} />
    </Page>
  );
}
