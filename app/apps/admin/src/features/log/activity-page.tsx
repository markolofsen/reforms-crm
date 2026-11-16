import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RunStatus } from "@hub/config";
import type { RunDto } from "@hub/contract/responses";
import { AlertTriangleIcon, CheckCircle2Icon, ChevronDownIcon, XCircleIcon, type LucideIcon } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { AppLink } from "@/components/app-link";
import { FilterChips } from "@/components/filter-chips";
import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { metaApi } from "@/lib/api/meta";
import { formatTime, usd } from "@/lib/format";
import { useSearchState } from "@/hooks/use-search-state";
import { paths } from "@/routes/paths";
import type { RunFilter } from "@/routes/search";
import { RunEvents } from "./run-events";
import { runMeta, runSentence } from "./run-summary";

/** Status is an icon and a word, never a colour alone. */
const RUN_STATUS: Record<RunStatus, { word: string; Icon: LucideIcon; tone: string }> = {
  ok: { word: "Done", Icon: CheckCircle2Icon, tone: "text-success-foreground" },
  needs_human: { word: "Needs you", Icon: AlertTriangleIcon, tone: "text-warning-foreground" },
  failed: { word: "Failed", Icon: XCircleIcon, tone: "text-destructive-foreground" },
};
const RUN_FILTER_LABELS: Record<RunFilter, string> = { all: "All", needs_human: "Needs you", failed: "Failed", ok: "Done" };
const RUN_FILTER_ORDER: readonly RunFilter[] = ["all", "needs_human", "failed", "ok"];
const RUN_FILTERS = RUN_FILTER_ORDER.map((value) => ({ value, label: RUN_FILTER_LABELS[value] }));

function RunItem({ r, open, project, onToggle }: { r: RunDto; open: boolean; project: string; onToggle: (open: boolean) => void }) {
  const { word, Icon, tone } = RUN_STATUS[r.status];
  return (
    <li className="min-w-0 py-3" data-run={r.id} id={`run-${r.id}`}>
      <Collapsible onOpenChange={onToggle} open={open}>
        <div className="flex min-w-0 items-start gap-3">
          <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone}`} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm">
              <span className="sr-only">{word}. </span>
              {runSentence(r)}
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">{runMeta(r, formatTime(r.startedAt))}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <CollapsibleTrigger
                render={
                  <ActionButton size="s" variant="quiet">
                    Details
                    <ChevronDownIcon aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
                  </ActionButton>
                }
              />
              {r.status === "needs_human" && (
                <AppLink to={paths.drafts.list()}>
                  See what needs you
                </AppLink>
              )}
            </div>
          </div>
        </div>
        <CollapsiblePanel>
          <div className="flex flex-col gap-2 ps-7 pt-2">
            <p className="text-muted-foreground text-xs tabular-nums">
              {r.model ?? "Model unknown"} · {r.trigger} · {r.tokensIn.toLocaleString("en-GB")} in, {r.tokensOut.toLocaleString("en-GB")} out · {usd(r.costUsd)}
            </p>
            {open && <RunEvents project={project} runId={r.id} />}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

/** What the agent did in one project, newest first. The filter and the opened run live in the address (`?filter=failed&run=3`). */
export function ActivityPage({ project, filter, openId }: { project: string; filter: RunFilter; openId: number | null }) {
  const setFilter = useSearchState("filter")[1];
  const setRun = useSearchState("run")[1];
  const runs = useQuery({ queryKey: ["runs", project], queryFn: () => metaApi.runs(project), refetchInterval: 10_000 });
  const all = runs.data?.runs;
  const shown = useMemo(() => (all ?? []).filter((r) => filter === "all" || r.status === filter), [all, filter]);

  if (runs.isPending) return <ListSkeleton label="Loading the activity" />;
  if (!all) return <LoadFailed error={runs.error} onRetry={() => void runs.refetch()} retrying={runs.isFetching} what="the activity" />;
  if (all.length === 0) return <EmptyState title="Nothing yet">It fills in after you ask the agent to process mail: each time it works, one line appears here.</EmptyState>;
  const chips = RUN_FILTERS.map((f) => ({ ...f, count: f.value === "all" ? all.length : all.filter((r) => r.status === f.value).length }));
  return (
    <>
      {runs.isError && <StaleNote error={runs.error} onRetry={() => void runs.refetch()} retrying={runs.isFetching} />}
      <FilterChips chips={chips} label="Filter activity" onChange={setFilter} value={filter} />
      {shown.length === 0 ? (
        <EmptyState action={<ActionButton onClick={() => setFilter("all")} size="s" variant="secondary">Show all</ActionButton>} title="Nothing here">
          Nothing matches this filter.
        </EmptyState>
      ) : (
        <ul aria-label="Activity" className="divide-y">
          {shown.map((r) => (
            <RunItem key={r.id} onToggle={(o) => setRun(o ? r.id : null)} open={openId === r.id} project={project} r={r} />
          ))}
        </ul>
      )}
    </>
  );
}
