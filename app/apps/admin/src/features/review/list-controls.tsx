import { ChevronDownIcon, ListChecksIcon } from "lucide-react";
import type { Ref } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { FilterChips } from "@hub/ui/product/filter-chips";
import { Input } from "@hub/ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@hub/ui/menu";
import { plural } from "@/lib/format";

export type View = { value: string; label: string; count: number | undefined };

type Header = {
  views: View[];
  view: string;
  onView: (v: string) => void;
  search: string;
  onSearch: (v: string) => void;
  searchRef: Ref<HTMLInputElement>;
  selecting: boolean;
  onSelecting: (on: boolean) => void;
};

/** The view as one menu: what a phone has instead of a row of chips (the chips are from 640px up). */
function ViewMenu({ views, view, onView }: Pick<Header, "views" | "view" | "onView">) {
  const now = views.find((v) => v.value === view);
  return (
    <Menu>
      <MenuTrigger render={<ActionButton aria-label={`Show drafts: ${now?.label ?? view}`} size="m" variant="secondary" />}>
        <span className="truncate">{now?.label ?? view}</span>
        <span className="font-normal tabular-nums">{now?.count ?? "-"}</span>
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup onValueChange={onView} value={view}>
          {views.map((v) => (
            <MenuRadioItem key={v.value} value={v.value}>
              {v.label} <span className="ms-auto ps-3 text-muted-foreground tabular-nums">{v.count ?? "-"}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * The line that stays on top of the list as it scrolls. From 640px: the views as chips with their counts, then the search and
 * Select. Under 640px (a phone): one line, the view as a menu beside the search, so the rows keep the screen.
 */
export function ListHeader({ views, view, onView, search, onSearch, searchRef, selecting, onSelecting }: Header) {
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-2 border-b bg-background p-3 max-md:py-1.5" data-testid="list-header">
      <div className="max-md:hidden">
        <FilterChips chips={views.map((v) => ({ ...v, count: v.count }))} label="Show drafts" onChange={onView} value={view} />
      </div>
      <div className="flex items-center gap-2">
        <div className="md:hidden">
          <ViewMenu onView={onView} view={view} views={views} />
        </div>
        <div className="min-w-0 flex-1">
          <Input aria-label="Search drafts" className="control-m" onChange={(e) => onSearch(e.target.value)} placeholder="Search name, email or subject" ref={searchRef} type="search" value={search} />
        </div>
        <ActionButton aria-label="Select drafts" aria-pressed={selecting} icon onClick={() => onSelecting(!selecting)} size="m" variant="secondary">
          <ListChecksIcon aria-hidden="true" />
        </ActionButton>
      </div>
    </div>
  );
}

/**
 * Where the pass stands: the open draft's place in the view, then what is done, sent and still to go. Zeros are left out
 * (except what is to go). The order is the server's, said once so nobody has to guess why a card is first.
 */
export function QueueLine({ position, total, done, sent, left }: { position: number | null; total: number; done: number; sent: number; left: number }) {
  const parts = [done > 0 ? `${done} done` : null, sent > 0 ? `${sent} sent` : null, `${left} to go`].filter(Boolean).join(", ");
  return (
    <div className="px-3 pt-2 text-muted-foreground text-xs" data-testid="queue-line">
      <p className="tabular-nums">
        {position !== null && total > 0 ? `${position} of ${total} · ` : total > 0 ? `${plural(total, "draft")} · ` : ""}
        {parts}
      </p>
      <p className="max-md:hidden">Replies owed first, then the longest silence.</p>
    </div>
  );
}

/** "3 selected: Skip, Hold, Clear". Skip and Hold apply to the open drafts among them. */
export function SelectionBar({ count, busy, onSkip, onHold, onClear }: { count: number; busy: boolean; onSkip: () => void; onHold: () => void; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-y bg-info/8 px-3 py-2" role="toolbar" aria-label="Selected drafts">
      <p className="me-auto font-medium text-sm tabular-nums" role="status">
        {count} selected
      </p>
      <ActionButton disabled={busy} onClick={onSkip} size="s" variant="secondary">
        Skip
      </ActionButton>
      <ActionButton disabled={busy} onClick={onHold} size="s" variant="secondary">
        Hold
      </ActionButton>
      <ActionButton onClick={onClear} size="s" variant="quiet">
        Clear
      </ActionButton>
    </div>
  );
}
