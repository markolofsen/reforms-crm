import type { WatchDto } from "@hub/contract/watch";
import { formatTime } from "@/lib/format";
import { freshnessLine, spendLine, STATE_WORD } from "./labels";

/** The standing, the spend and the next analysis: one line under the header. */
export function Standing({ d }: { d: WatchDto }) {
  const freshness = freshnessLine(d.freshness);
  return (
    <p className="text-muted-foreground text-sm" data-testid="watch-standing" role="status">
      <span className="font-medium text-foreground">{STATE_WORD[d.standing.state]}</span>
      {d.standing.reason && <> · {d.standing.reason}</>}
      {d.standing.until && <> · until {formatTime(d.standing.until)}</>}
      {d.lens && <> · lens {d.lens.title}{d.lens.version !== undefined && <> v{d.lens.version}</>}</>}
      <> · {spendLine(d.spend)}</>
      {d.nextAnalysis && <> · next analysis {formatTime(d.nextAnalysis)}</>}
      {freshness && <> · {freshness}</>}
    </p>
  );
}

/** P153: what the server could not take from a changed watch.md or lens.json, or that the lens's code waits for a restart. */
export function Notice({ d }: { d: WatchDto }) {
  if (d.notice === null) return null;
  return (
    <p className="text-sm text-warning-foreground" data-testid="watch-notice" role="status">
      {d.notice}
    </p>
  );
}
