import { ListChecksIcon } from "lucide-react";
import type { RefObject } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { SearchField } from "@hub/ui/product/search-field";
import { ListFilterMenu, ListToolbar, ListToolbarRow } from "@hub/ui/product/list-toolbar";
import { Refreshing } from "@/components/state-views";

/** One entry of the View menu. `group` starts a labelled block (the batches). */
export type View = { value: string; label: string; count: number | undefined; group?: string };

type Selection = { count: number; busy: boolean; onSkip: () => void; onHold: () => void; onClear: () => void };
type Header = {
  views: View[];
  view: string;
  onView: (v: string) => void;
  search: string;
  onSearch: (v: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  selecting: boolean;
  onSelecting: (on: boolean) => void;
  selection: Selection;
  refreshing: boolean;
};

/**
 * The view as ONE menu with counts, at every width: the views, Follow-ups, Not by email, then the batches (read-only). Its trigger
 * is the list's title, "Mail · Needs you 2" (P128 X4); a filter or a batch with nothing in it is left out unless it is the one
 * on screen (the three views always show, so the owner sees an empty Needs you as such).
 */
function ViewMenu({ views, view, onView }: Pick<Header, "views" | "view" | "onView">) {
  const shown = views.filter((v) => v.group === undefined || v.value === view || v.count !== 0);
  return <ListFilterMenu name="View" onChange={onView} options={shown} tooltip="Filter mail by view" value={view} where="Mail" />;
}

/**
 * "3 selected · Skip · Hold · Clear": the header line itself while drafts are picked, so nothing below it moves. Its height is
 * the header line's: the search field is `control-s` inside its 1px border, 2px taller than the buttons beside it.
 */
function SelectionLine({ count, busy, onSkip, onHold, onClear }: Selection) {
  return (
    <div aria-label="Selected drafts" className="flex h-[calc(var(--control-s)+2px)] min-w-0 items-center gap-2" role="toolbar">
      <p className="me-auto min-w-0 truncate font-medium text-sm tabular-nums">{count} selected</p>
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

/**
 * The one line on top of the list (sticky while it scrolls): the View menu, the search and Select. While drafts are picked the
 * same line, at the same height, becomes the selection's actions: the rows below never shift (P48 W4).
 */
export function ListHeader({ views, view, onView, search, onSearch, searchRef, selecting, onSelecting, selection, refreshing }: Header) {
  return (
    <ListToolbar ariaLabel="Mail filters and actions" role={selection.count > 0 ? null : "toolbar"} testId="list-header">
      {/* Always mounted, so a screen reader hears the count change (a region that appears with its text is often not read). */}
      <p className="sr-only" role="status">
        {selection.count > 0 ? `${selection.count} selected` : ""}
      </p>
      {selection.count > 0 ? (
        <SelectionLine {...selection} />
      ) : (
        // One line at every width, the search between the View and Select: a second line pushed the first draft past 200px on a
        // phone (admin-principles 3) and made the rows jump when a selection replaced both lines (ui-specifications 4a).
        <ListToolbarRow className="flex-nowrap">
          <ViewMenu onView={onView} view={view} views={views} />
          <div className="min-w-0 flex-1">
            <SearchField inputRef={searchRef} label="Search drafts" onChange={onSearch} value={search} />
          </div>
          <ActionButton aria-label={selecting ? "Exit draft selection" : "Select drafts"} aria-pressed={selecting} icon onClick={() => onSelecting(!selecting)} size="s" tooltip={selecting ? "Exit draft selection" : "Select drafts"} variant="secondary">
            <ListChecksIcon aria-hidden="true" />
          </ActionButton>
          {refreshing && <Refreshing />}
        </ListToolbarRow>
      )}
    </ListToolbar>
  );
}
