import type { WatchDto, WatchView } from "@hub/contract/watch";
import { FilterChips, type Chip } from "@hub/ui/product/list/filter-chips";
import { ListFilterMenu } from "@hub/ui/product/list/toolbar";
import { useGo } from "@/hooks/use-go";
import { WATCH_DAYS } from "@/routes/search";
import { directionLabel, VIEW_LABEL, VIEW_ORDER, watchDest, type WatchSearch } from "./labels";

/** The existing views and period remain filters; directions appear only when there is a choice. */
export function WatchHeader({ q, data }: { q: WatchSearch; data: WatchDto | undefined }) {
  const go = useGo();
  const views: Chip<WatchView>[] = VIEW_ORDER.filter((v) => v === "triggers" || v === "moments" || v === "groups").map((v) => ({ value: v, label: VIEW_LABEL[v], count: null }));
  const days = WATCH_DAYS.map((d) => ({ value: d, label: `${d} days`, count: null }));
  const directions = data?.directions ?? [];
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
      {directions.length > 1 && (
        <ListFilterMenu
          name="Direction"
          options={directions.map((direction) => ({ value: direction.id, label: directionLabel(direction) }))}
          value={q.direction || data?.direction || ""}
          onChange={(direction) => go(watchDest(q, { direction }), { replace: true })}
        />
      )}
      <div className="min-w-0 flex-1 basis-80">
        <FilterChips chips={views} label="Watch views" onChange={(view) => go(watchDest(q, { view }), { replace: true })} value={q.view} />
      </div>
      <ListFilterMenu name="Analysis" options={VIEW_ORDER.map((v) => ({ value: v, label: VIEW_LABEL[v] }))} value={q.view} onChange={(v) => go(watchDest(q, { view: VIEW_ORDER.find((x) => x === v) ?? "triggers" }), { replace: true })} />
      <div className="w-48 shrink-0">
        <FilterChips chips={days} label="Period" onChange={(period) => go(watchDest(q, { days: period }), { replace: true })} value={q.days} />
      </div>
    </div>
  );
}
