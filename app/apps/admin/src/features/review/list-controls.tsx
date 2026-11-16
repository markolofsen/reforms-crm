import { ListChecksIcon } from "lucide-react";
import type { Ref } from "react";
import { ActionButton } from "@/components/action-button";
import { FilterChips } from "@/components/filter-chips";
import { Input } from "@/components/ui/input";

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

/** Above the rows: the views with their counts, the search, and Select (the way into the bulk mode on touch). */
export function ListHeader({ views, view, onView, search, onSearch, searchRef, selecting, onSelecting }: Header) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <FilterChips chips={views.map((v) => ({ ...v, count: v.count }))} label="Show drafts" onChange={onView} value={view} />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input aria-label="Search the loaded drafts" className="control-m" onChange={(e) => onSearch(e.target.value)} placeholder="Search name, email or subject" ref={searchRef} type="search" value={search} />
        </div>
        <ActionButton aria-label="Select drafts" aria-pressed={selecting} icon onClick={() => onSelecting(!selecting)} size="m" variant="secondary">
          <ListChecksIcon aria-hidden="true" />
        </ActionButton>
      </div>
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
