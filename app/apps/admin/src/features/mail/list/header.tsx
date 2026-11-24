import { ListChecksIcon } from "lucide-react";
import type { RefObject } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { SearchField } from "@hub/ui/product/list/search-field";
import { ListToolbar, ListToolbarRow } from "@hub/ui/product/list/toolbar";
import { ListViewTitle } from "@/components/conversation/list-title";
import { Refreshing } from "@/components/state-views";
import { ListFilterButton, type BrandCount, type FilterOption } from "./filter-menu";

/** One view of the list: its title, and on a phone an entry of the View menu. */
export type View = { value: string; label: string; count: number | undefined };
/** The filter button's content (P134 verdicts 1 and 4): the filters of All and the brands of the list. */
export type Filters = { options: readonly FilterOption[]; value: string | null; onChange: (v: string | null) => void; brands: readonly BrandCount[]; brand: string | null; onBrand: (b: string | null) => void };

type Selection = { count: number; busy: boolean; onSkip: () => void; onHold: () => void; onClear: () => void };
type Header = {
  views: View[];
  view: string;
  onView: (v: string) => void;
  filters: Filters;
  search: string;
  onSearch: (v: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  selecting: boolean;
  onSelecting: (on: boolean) => void;
  selection: Selection;
  refreshing: boolean;
};

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
 * The one line on top of the list (sticky while it scrolls): the title (P134: the view is chosen in the sidebar), the search, the
 * filter button and Select. While drafts are picked the
 * same line, at the same height, becomes the selection's actions: the rows below never shift (P48 W4).
 */
export function ListHeader({ views, view, onView, filters, search, onSearch, searchRef, selecting, onSelecting, selection, refreshing }: Header) {
  return (
    <ListToolbar ariaLabel="Mail filters and actions" role={selection.count > 0 ? null : "toolbar"} testId="list-header">
      {/* Always mounted, so a screen reader hears the count change (a region that appears with its text is often not read). */}
      <p className="sr-only" role="status">
        {selection.count > 0 ? `${selection.count} selected` : ""}
      </p>
      {selection.count > 0 ? (
        <SelectionLine {...selection} />
      ) : (
        // One line at every width, the search between the title and Select: a second line pushed the first draft past 200px on a
        // phone (admin-principles 3) and made the rows jump when a selection replaced both lines (ui-specifications 4a).
        <ListToolbarRow className="flex-nowrap">
          <ListViewTitle name="View" onChange={onView} options={views} tooltip="Choose the view" value={view} />
          <div className="min-w-0 flex-1">
            <SearchField inputRef={searchRef} label="Search drafts" onChange={onSearch} value={search} />
          </div>
          <ListFilterButton brand={filters.brand} brands={filters.brands} filter={filters.value} filters={filters.options} onBrand={filters.onBrand} onFilter={filters.onChange} what="mail" />
          <ActionButton aria-label={selecting ? "Exit draft selection" : "Select drafts"} aria-pressed={selecting} icon onClick={() => onSelecting(!selecting)} size="s" tooltip={selecting ? "Exit draft selection" : "Select drafts"} variant="secondary">
            <ListChecksIcon aria-hidden="true" />
          </ActionButton>
          {refreshing && <Refreshing />}
        </ListToolbarRow>
      )}
    </ListToolbar>
  );
}
