import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BATCH_FILTER_LABELS, BATCH_FILTERS, EXCLUSION_LABELS, EXCLUSION_REASONS, INTENT_LABELS, type BatchFilter } from "@hub/config";
import { AppLink } from "@/components/app-link";
import { Progress } from "@hub/ui/product/field";
import { LoadFailed, Loading } from "@/components/state-views";
import { Alert, AlertDescription } from "@hub/ui/alert";
import { paneStateOf } from "@/features/review/card/card-state";
import { ReviewWorkspace } from "@/features/review/workspace";
import type { ReviewSource } from "@/features/review/source";
import { PaneScroll } from "@/features/shell/split-view";
import { useSearchState } from "@/hooks/use-search-state";
import { bulkApi } from "@/lib/api/bulk";
import { tokens, usd } from "@/lib/format";
import { paths } from "@/routes/paths";

const VIEWS = BATCH_FILTERS.map((f) => ({ value: f, label: BATCH_FILTER_LABELS[f] }));
const POLL_MS = 4_000;

/** State 16 in the pane: no button, because there is nothing to do but wait. */
function BatchWaiting({ written, total }: { written: number; total: number }) {
  return (
    <section aria-label="Waiting for the agent" className="flex flex-col gap-3 p-6" data-testid="batch-waiting">
      <h3 className="font-heading font-semibold text-base">Waiting for the agent</h3>
      <Progress label={`${written} of ${total} drafts written`} max={total} value={written} />
      <p className="text-muted-foreground text-sm">The first draft opens here when it arrives. You can leave this page: the drafts will be in the list.</p>
    </section>
  );
}

/** One batch: its progress above the list, then the same review list and card as Drafts. A queued batch fills in by itself. */
export function BatchSection({ project, batchId, filter, mobile }: { project: string; batchId: number; filter: BatchFilter; mobile: boolean }) {
  const setView = useSearchState("filter")[1];
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const head = useQuery({
    queryKey: ["batch", project, batchId],
    queryFn: () => bulkApi.get(project, batchId, "all", 0),
    refetchInterval: (query) => (query.state.data?.batch.status === "queued" ? POLL_MS : false),
  });
  const batch = head.data?.batch;
  const queued = batch?.status === "queued";
  const source = useMemo<ReviewSource>(
    () => ({
      queryKey: ["batch-drafts", project, batchId, filter],
      project,
      filter,
      countOf: (counts, view) => counts[view],
      load: async (offset) => {
        const page = await bulkApi.get(project, batchId, filter, offset);
        return { ...page, counts: page.batch.counts };
      },
      undoLast: () => bulkApi.undoLast(project, batchId),
      refetchMs: queued ? POLL_MS : false,
    }),
    [project, batchId, filter, queued],
  );

  if (head.isPending)
    return (
      <PaneScroll>
        <Loading what="the batch" />
      </PaneScroll>
    );
  if (!batch)
    return (
      <PaneScroll>
        <LoadFailed error={head.error} onRetry={() => void head.refetch()} retrying={head.isFetching} what="this batch" />
      </PaneScroll>
    );

  const done = batch.counts.done + batch.counts.skipped;
  const left = EXCLUSION_REASONS.flatMap((r) => {
    const n = batch.excluded[r];
    return n ? [`${n} ${EXCLUSION_LABELS[r].toLowerCase()}`] : [];
  });
  const top = (
    <div className="flex flex-col gap-2 border-b p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AppLink to={paths.bulk.list()}>All batches</AppLink>
      </div>
      <h3 className="min-w-0 break-words font-heading font-semibold text-base">{batch.name}</h3>
      <Progress label={`${done} of ${batch.total} finished`} max={batch.total} value={done} />
      <p className="text-muted-foreground text-xs tabular-nums">
        {done} of {batch.total} finished · {INTENT_LABELS[batch.intent]}
        {batch.run ? ` · ${usd(batch.run.costUsd)} · ${tokens(batch.run.tokensIn + batch.run.tokensOut)} tokens` : ""}
        {left.length > 0 ? ` · Left out: ${left.join(", ")}` : ""}
      </p>
      {queued && (
        <Alert variant="warning">
          <AlertDescription>
            Waiting for the agent: {batch.counts.all} of {batch.total} drafts written. This page updates by itself.
          </AlertDescription>
        </Alert>
      )}
      {batch.status === "failed" && (
        <Alert variant="error">
          <AlertDescription>The agent stopped before it wrote every draft ({batch.counts.all} of {batch.total}). See Activity for the run.</AlertDescription>
        </Alert>
      )}
    </div>
  );
  // State 16: nothing has arrived yet, so the pane tells where the batch stands; the list fills by itself.
  const waiting = paneStateOf({ status: batch.status, written: batch.counts.all }) === "batch_waiting";
  return (
    <ReviewWorkspace
      empty={() => (queued ? "No draft has arrived yet." : `No draft is ${BATCH_FILTER_LABELS[filter].toLowerCase()} in this batch.`)}
      idle={waiting ? <BatchWaiting total={batch.total} written={batch.counts.all} /> : undefined}
      listTop={top}
      mobile={mobile}
      noun={{ list: "Batch drafts", back: "Batch" }}
      onView={setView}
      search={[q, setQ]}
      selection={{ id: open, onChange: setOpen }}
      source={source}
      views={VIEWS}
    />
  );
}
