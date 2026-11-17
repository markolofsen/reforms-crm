import { useQuery } from "@tanstack/react-query";
import { EXCLUSION_LABELS, EXCLUSION_REASONS, INTENT_LABELS } from "@hub/config";
import type { BatchSummaryDto } from "@hub/contract/responses";
import { Alert, AlertDescription } from "@hub/ui/alert";
import { Progress } from "@hub/ui/product/field";
import { AppLink } from "@/components/app-link";
import { bulkApi } from "@/lib/api/bulk";
import { tokens, usd } from "@/lib/format";
import { paths } from "@/routes/paths";

/** A batch waiting for the agent fills in by itself, so its head and its list are read again every few seconds. */
export const BATCH_POLL_MS = 4_000;

/** The batch a `?batch=` address names: its summary, read again while the agent is still writing. Idle when no batch is named. */
export function useBatchHead(project: string, batchId: number | null) {
  return useQuery({
    queryKey: ["batch", project, batchId],
    queryFn: () => bulkApi.get(project, batchId ?? 0),
    enabled: batchId !== null,
    refetchInterval: (query) => (query.state.data?.batch.status === "queued" ? BATCH_POLL_MS : false),
  });
}

/** State 16 in the pane: no button, because there is nothing to do but wait. */
export function BatchWaiting({ written, total }: { written: number; total: number }) {
  return (
    <section aria-label="Waiting for the agent" className="flex flex-col gap-3 p-6" data-testid="batch-waiting">
      <h3 className="font-heading font-semibold text-base">Waiting for the agent</h3>
      <Progress label={`${written} of ${total} drafts written`} max={total} value={written} />
      <p className="text-muted-foreground text-sm">The first draft opens here when it arrives. You can leave this page: the drafts will be in the list.</p>
    </section>
  );
}

/** The batch's own line above its drafts: name, how far the review is, the cost, who was left out, and what the agent is doing. */
export function BatchHead({ batch }: { batch: BatchSummaryDto }) {
  const done = batch.counts.done + batch.counts.skipped;
  const left = EXCLUSION_REASONS.flatMap((r) => {
    const n = batch.excluded[r];
    return n ? [`${n} ${EXCLUSION_LABELS[r].toLowerCase()}`] : [];
  });
  return (
    <div className="mx-3 mt-3 flex flex-col gap-2 rounded-lg border p-3" data-testid="batch-head">
      <h3 className="min-w-0 break-words font-heading font-semibold text-sm">{batch.name}</h3>
      <Progress label={`${done} of ${batch.total} finished`} max={batch.total} value={done} />
      <p className="text-muted-foreground text-xs tabular-nums">
        {done} of {batch.total} finished · {INTENT_LABELS[batch.intent]}
        {batch.run ? ` · ${usd(batch.run.costUsd)} · ${tokens(batch.run.tokensIn + batch.run.tokensOut)} tokens` : ""}
        {left.length > 0 ? ` · Left out: ${left.join(", ")}` : ""}
      </p>
      {batch.status === "queued" && (
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
}

/** A batch id that is not in this project (an old link): said plainly, with the way back. */
export function BatchGone() {
  return (
    <p className="mx-3 mt-3 rounded-lg border p-3 text-sm" data-testid="batch-gone" role="status">
      That batch is not in this project. <AppLink to={paths.drafts.list()}>Show all drafts</AppLink>
    </p>
  );
}
