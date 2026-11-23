import { useOpsErrors } from "@/lib/data/overview";
import { ChevronDownIcon, CircleXIcon } from "lucide-react";
import type { OpsErrorRowDto } from "@hub/contract/ops-log";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { ago } from "@/lib/format";
import { placeDest } from "./labels";

/** Where the error is fixed: its source as a link to that page, or plain text when the page is Overview itself. */
function Where({ r }: { r: OpsErrorRowDto }) {
  if (r.place === null || r.place === "overview") return <span className="font-medium">{r.source}</span>;
  return (
    <AppLink className="font-medium text-foreground" inProject={r.project} to={placeDest(r.place)}>
      {r.source}
    </AppLink>
  );
}

/**
 * Recent errors (P86): the newest `error` lines of the ops log of the last 24 h (`GET /api/ops/errors`), folded like All parts:
 * each its source (a link to the page that fixes it), when, and the redacted message. Nothing in view when there is none; no
 * control, the full log is `./run.sh logs --level error`. Refetched on the live topic `ops-log`. `now` comes from the clock.
 */
export function RecentErrors({ now }: { now: number }) {
  const q = useOpsErrors();
  const d = q.data;
  if (!d || d.total === 0) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group -ms-3 justify-start gap-2" data-testid="recent-errors" render={<ActionButton size="m" variant="quiet" />}>
        Recent errors
        <span className="font-normal text-muted-foreground tabular-nums">{d.total}</span>
        <ChevronDownIcon aria-hidden="true" className="transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul aria-label="Recent errors" className="flex flex-col divide-y border-y">
          {d.rows.map((r) => (
            <li className="flex min-w-0 gap-3 py-3" key={`${r.time}:${r.source}:${r.message}`}>
              <CircleXIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <Where r={r} />
                  <span className="text-muted-foreground text-xs">{ago(r.time, now)}</span>
                </p>
                <p className="measure break-words text-muted-foreground [overflow-wrap:anywhere]">{r.message}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-muted-foreground text-xs">
          {d.total > d.rows.length ? `The newest ${d.rows.length} of ${d.total} in the last ${d.hours} h. ` : `The last ${d.hours} h. `}
          Every line: <code className="rounded-sm bg-muted px-1 py-0.5">./run.sh logs --level error</code>
        </p>
      </CollapsiblePanel>
    </Collapsible>
  );
}
