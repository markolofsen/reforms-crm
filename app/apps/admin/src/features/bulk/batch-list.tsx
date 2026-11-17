import { useQuery } from "@tanstack/react-query";
import { INTENT_LABELS } from "@hub/config";
import type { BatchSummaryDto } from "@hub/contract/responses";
import { Progress } from "@hub/ui/product/field";
import { EmptyState, ListSkeleton, LoadFailed } from "@/components/state-views";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { bulkApi } from "@/lib/api/bulk";
import { formatTime, tokens, usd } from "@/lib/format";
import { paths } from "@/routes/paths";

const STATUS: Record<BatchSummaryDto["status"], { label: string; variant: "warning" | "info" | "error" }> = {
  queued: { label: "Waiting for the agent", variant: "warning" },
  ready: { label: "Ready", variant: "info" },
  failed: { label: "Agent stopped", variant: "error" },
};

function BatchItem({ b }: { b: BatchSummaryDto }) {
  const done = b.counts.done + b.counts.skipped;
  return (
    <li>
      <AppLink bare className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring min-h-(--control-s)" to={paths.bulk.item(b.id)}>
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 max-w-full truncate font-medium">{b.name}</span>
          <Badge variant={STATUS[b.status].variant}>{STATUS[b.status].label}</Badge>
        </span>
        <Progress label={`${done} of ${b.total} finished`} max={b.total} value={done} />
        <span className="text-muted-foreground text-xs tabular-nums">
          {b.status === "queued" ? `${b.counts.all} of ${b.total} drafts written. ` : ""}
          {done} of {b.total} finished. To review {b.counts.review}, Ready {b.counts.checked}, Hold {b.counts.hold}, Done {b.counts.done}, Skipped {b.counts.skipped}.
        </span>
        <span className="text-muted-foreground text-xs">
          {INTENT_LABELS[b.intent]} · {formatTime(b.createdAt)}
          {b.run ? ` · ${usd(b.run.costUsd)} · ${tokens(b.run.tokensIn + b.run.tokensOut)} tokens` : ""}
        </span>
      </AppLink>
    </li>
  );
}

/** The batches of a project. A batch waiting for the agent fills in by itself. */
export function BatchList({ project }: { project: string }) {
  const q = useQuery({
    queryKey: ["batches", project],
    queryFn: () => bulkApi.list(project),
    refetchInterval: (query) => (query.state.data?.batches.some((b) => b.status === "queued") ? 4_000 : false),
  });
  const newBatch = (
    <ActionButton render={<AppLink bare to={paths.bulk.new()} />} size="s" variant="primary">
      New batch
    </ActionButton>
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="me-auto text-muted-foreground text-sm">A batch makes many drafts at once. You review each one before anything goes out.</p>
        {newBatch}
      </div>
      {q.isPending ? (
        <ListSkeleton label="Loading batches" />
      ) : q.isError ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="batches" />
      ) : q.data.batches.length === 0 ? (
        <EmptyState title="No batches yet">
          Pick the clients and brief the agent; it writes one draft for each, and the drafts appear here for review.
          <span className="mt-2 block">{newBatch}</span>
        </EmptyState>
      ) : (
        <ul aria-label="Batches" className="flex flex-col gap-2">
          {q.data.batches.map((b) => (
            <BatchItem b={b} key={b.id} />
          ))}
        </ul>
      )}
    </>
  );
}
