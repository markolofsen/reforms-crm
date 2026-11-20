import { EmptyState, LoadFailed, StaleNote } from "@/components/state-views";
import { phrase } from "@hub/contract/help";
import { Skeleton } from "@hub/ui/skeleton";
import { usePlace } from "@/hooks/use-project";
import { useClock } from "@/lib/clock";
import { ConnectionRow } from "./connection-row";
import { groupByKind } from "./labels";
import { useConnectionActions, useConnections } from "./use-connections";

function ConnectionsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the connections" className="flex flex-col gap-4" role="status">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

/**
 * Settings ▸ Connections (P70): the instance's two keys, the Notion token and the Telegram bot, one list, each row its label. The projects'
 * mail accounts are on Settings ▸ Mail (they are a project's, read-only) and how this instance starts on Settings ▸ This Mac. It
 * reads `GET /api/connections` and tests a key on request. A key is never shown: a row says where it stands, not what it is.
 */
export function ConnectionsView() {
  const now = useClock()();
  const { multi } = usePlace();
  const q = useConnections();
  const { status, busy, test, save, remove } = useConnectionActions();
  const data = q.data;

  if (q.isPending) return <ConnectionsSkeleton />;
  if (!data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the connections" />;
  if (data.connections.length === 0) return <EmptyState title="No connections yet">They appear here once a project is set up: say “{phrase("project-setup")}” in a session.</EmptyState>;
  return (
    <>
      {/* One list of keys, each row named by its own label: a "Notion" heading over "Notion integration" said it twice (UX pass). */}
      <ul aria-label="Keys" className="flex flex-col divide-y border-y">
        {groupByKind(data.connections).flatMap((g) => g.rows).map((r) => (
          <ConnectionRow actions={{ test: () => void test(r), save: (b) => save(r, b), remove: () => remove(r) }} busy={busy === r.id} key={r.id} locked={busy !== null} multi={multi} now={now} row={r} />
        ))}
      </ul>
      {/* One live region for every Test, save and remove: a result is a status, a failure an alert. */}
      <div className="min-h-5 text-sm">
        <p role="status">{status?.kind === "status" ? status.text : ""}</p>
        <p className="text-destructive-foreground" role="alert">
          {status?.kind === "alert" ? status.text : ""}
        </p>
      </div>
      {q.isError && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
    </>
  );
}
