import { RefreshCwIcon } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { EmptyState, LoadFailed, StaleNote } from "@/components/state-views";
import { Skeleton } from "@/components/ui/skeleton";
import { useClock } from "@/lib/clock";
import { ConnectionRow } from "./connection-row";
import { groupByKind, KIND_TITLE } from "./labels";
import { useConnections, useTest } from "./use-connections";

function ConnectionsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the connections" className="flex flex-col gap-4" role="status">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

/**
 * Every account of the instance in one place: mail logins, the Notion token, the Telegram bot. It reads `GET /api/connections` (files and
 * settings, no network) and tests one connection on request. A key is never shown: a row says where it stands, not what it is.
 */
export function ConnectionsView() {
  const now = useClock()();
  const q = useConnections();
  const { status, busy, test } = useTest();
  const data = q.data;

  const header = (
    <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-background px-4 py-2 sm:-mx-6 sm:px-6">
      <h3 className="font-heading font-medium text-lg">Connections</h3>
      <p className="me-auto text-muted-foreground text-xs">{data ? `Instance ${data.instance}` : ""}</p>
      <ActionButton aria-busy={q.isFetching} disabled={q.isFetching} onClick={() => void q.refetch()} size="m" variant="secondary">
        <RefreshCwIcon aria-hidden="true" />
        Reload
      </ActionButton>
    </div>
  );
  if (q.isPending) return <>{header}<ConnectionsSkeleton /></>;
  if (!data) return <>{header}<LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the connections" /></>;
  if (data.connections.length === 0) return <>{header}<EmptyState title="No connections yet">Run `hub connections` for the same list in the terminal.</EmptyState></>;
  return (
    <>
      {header}
      <div className="min-h-5 text-sm">
        <p role="status">{status?.kind === "status" ? status.text : ""}</p>
        <p className="text-destructive-foreground" role="alert">
          {status?.kind === "alert" ? status.text : ""}
        </p>
      </div>
      {q.isError && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
      {groupByKind(data.connections).map((g) => (
        <section aria-labelledby={`kind-${g.kind}`} key={g.kind}>
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide" id={`kind-${g.kind}`}>
            {KIND_TITLE[g.kind]}
          </h4>
          <ul className="flex flex-col divide-y">
            {g.rows.map((r) => (
              <ConnectionRow busy={busy === r.id} key={r.id} locked={busy !== null} now={now} onTest={() => void test(r.id, r.label)} row={r} />
            ))}
          </ul>
        </section>
      ))}
      <p className="text-muted-foreground text-xs">Keys are never shown here. A test reads from the service and changes nothing.</p>
    </>
  );
}
