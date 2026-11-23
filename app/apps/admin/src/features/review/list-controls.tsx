import { ListChecksIcon } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Input } from "@hub/ui/input";
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

/** The view as ONE menu with counts, at every width: the views, Follow-ups, Not by email, then the batches (read-only). */
function ViewMenu({ views, view, onView }: Pick<Header, "views" | "view" | "onView">) {
  return <ListFilterMenu ariaLabel="Filter mail by view" onChange={onView} options={views} tooltip="Filter mail by view" value={view} />;
}

/**
 * The search box. The address is the state (a search is a link), but it follows `replaceState` a moment late: a box bound only to it
 * dropped letters typed faster than the page caught up (P44 S1 measured "Marta Fic" arriving as "Mata Fic" at 30 ms a key). The box
 * keeps what the person typed; the address is adopted only while the box is not the one being typed in (Back, a link, Clear).
 */
function SearchBox({ search, onSearch, searchRef }: Pick<Header, "search" | "onSearch" | "searchRef">) {
  const [text, setText] = useState(search);
  useEffect(() => {
    if (searchRef.current !== document.activeElement) setText(search);
  }, [search, searchRef]);
  return <Input aria-label="Search drafts" className="control-s" onChange={(e) => { setText(e.target.value); onSearch(e.target.value); }} placeholder="Search" ref={searchRef} type="search" value={text} />;
}

/** "3 selected · Skip · Hold · Clear": the header line itself while drafts are picked, so nothing below it moves. */
function SelectionLine({ count, busy, onSkip, onHold, onClear }: Selection) {
  return (
    <div aria-label="Selected drafts" className="flex h-(--control-s) min-w-0 items-center gap-2" role="toolbar">
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
        <ListToolbarRow>
          <ViewMenu onView={onView} view={view} views={views} />
          <div className="min-w-0 flex-1 @max-3xl:order-last @max-3xl:basis-full">
            <SearchBox onSearch={onSearch} search={search} searchRef={searchRef} />
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
