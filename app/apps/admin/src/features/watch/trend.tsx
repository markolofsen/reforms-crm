import type { WatchDto } from "@hub/contract/watch";
import { EmptyState } from "@/components/state-views";
import { formatDay } from "@/lib/format";
import { triggerLabel } from "./labels";

/** One trigger's days as a strip of bars (the height is the day's share of the strip's busiest day). */
export function DayBars({ counts, label }: { counts: readonly number[]; label: string }) {
  const top = Math.max(1, ...counts);
  return (
    <span aria-label={`${label}: ${counts.reduce((a, b) => a + b, 0)} over ${counts.length} days`} className="flex h-6 items-end gap-px" role="img">
      {counts.map((c, i) => (
        <span className="w-1 rounded-sm bg-foreground/60" key={i} style={{ height: `${Math.max(c > 0 ? 12 : 4, Math.round((c / top) * 100))}%`, opacity: c > 0 ? 1 : 0.25 }} />
      ))}
    </span>
  );
}

/** Moments per day of each trigger over the period. */
export function Trend({ d }: { d: WatchDto }) {
  if (d.trend.series.length === 0) return <EmptyState title="No moment in this period" />;
  const first = d.trend.days[0];
  const last = d.trend.days.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {first && last && (
        <p className="text-muted-foreground text-sm">
          Moments per day, {formatDay(first)} to {formatDay(last)}.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {d.trend.series.map((s) => (
          <li className="grid grid-cols-[minmax(8rem,14rem)_1fr] items-end gap-3" key={s.trigger}>
            <span className="text-sm">{triggerLabel(d, s.trigger)}</span>
            <DayBars counts={s.counts} label={triggerLabel(d, s.trigger)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
