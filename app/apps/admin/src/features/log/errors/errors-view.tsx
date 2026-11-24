import { CircleXIcon, AlertTriangleIcon } from "lucide-react";
import type { OpsLineRowDto } from "@hub/contract/ops-log";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { useClock } from "@/lib/clock";
import { useOpsLines } from "@/lib/data/overview";
import { ago } from "@/lib/format";
import { dest } from "@/routes/paths";
import { NEXT_ROUTE } from "@/routes/sections";

/** The part a line is about, as a link to the page that fixes it (Recent errors' rule); plain text when that page is Overview. */
function Where({ r }: { r: OpsLineRowDto }) {
  if (r.place === null || r.place === "overview") return <span className="font-medium">{r.source}</span>;
  return (
    <AppLink className="font-medium text-foreground" inProject={r.project} to={dest(NEXT_ROUTE[r.place])}>
      {r.source}
    </AppLink>
  );
}

/** One line: its level as an icon and a word (never a colour alone), where, when, the redacted message, and its action. */
function Line({ r, now }: { r: OpsLineRowDto; now: number }) {
  const Icon = r.level === "error" ? CircleXIcon : AlertTriangleIcon;
  return (
    <li className="flex min-w-0 gap-3 py-3">
      <Icon aria-hidden="true" className={r.level === "error" ? "mt-0.5 size-4 shrink-0 text-destructive-foreground" : "mt-0.5 size-4 shrink-0 text-warning-foreground"} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="sr-only">{r.level === "error" ? "Error" : "Warning"}:</span>
          <Where r={r} />
          <span className="text-muted-foreground text-xs">{ago(r.time, now)}</span>
          {r.action && <code className="rounded-sm bg-muted px-1 py-0.5 text-muted-foreground text-xs">{r.action}</code>}
        </p>
        <p className="measure break-words text-muted-foreground [overflow-wrap:anywhere]">{r.message}</p>
      </div>
    </li>
  );
}

/**
 * Activity ▸ Errors (P137 L3): the ops log's warn and error lines of the last day for the whole Hub, newest first. Each line links
 * the part to the page that fixes it and shows its action id: the lines of one click read together with
 * `./run.sh logs --action <id>`. Refetched on the live topic `ops-log`, like Overview's Recent errors.
 */
export function ErrorsView() {
  const q = useOpsLines();
  const now = useClock()();
  return (
    <QueryView
      empty={<EmptyState title="No errors or warnings">Nothing failed in the last day.</EmptyState>}
      isEmpty={(d) => d.rows.length === 0}
      loading={<ListSkeleton label="Loading the errors" />}
      query={q}
      what="the errors"
    >
      {(d) => (
        <>
          <p className="text-muted-foreground text-sm" data-testid="activity-errors">
            {d.errors} {d.errors === 1 ? "error" : "errors"} and {d.warnings} {d.warnings === 1 ? "warning" : "warnings"} in the last {d.hours} h
            {d.rows.length < d.errors + d.warnings ? `, the newest ${d.rows.length} shown` : ""}.
          </p>
          <ul aria-label="Errors and warnings" className="flex flex-col divide-y border-y">
            {d.rows.map((r) => (
              <Line key={`${r.time}:${r.source}:${r.message}`} now={now} r={r} />
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            Every line: <code className="rounded-sm bg-muted px-1 py-0.5">./run.sh logs --level warn</code>
          </p>
        </>
      )}
    </QueryView>
  );
}
