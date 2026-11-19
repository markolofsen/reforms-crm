import { EmptyState, LoadFailed, StaleNote } from "@/components/state-views";
import { Skeleton } from "@hub/ui/skeleton";
import { AutostartRow } from "./autostart/autostart-row";
import { useClock } from "@/lib/clock";
import { ConnectionRow } from "./connection-row";
import { ConnectionGroup } from "./group";
import { groupByKind, KIND_TITLE } from "./labels";
import { MailAccounts } from "./mail-accounts";
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
 * Every account of the instance in one place, one group per kind: the projects' mail accounts (read-only, as Apple Mail
 * knows them), the Notion token and the Telegram bot, and "This Mac" (P67: whether the Mac starts the Hub at login); each project's
 * Agent tools moved to Agents (P63), since they are a project's, not the instance's. It reads `GET /api/connections` (files and settings, one bounded read of
 * Mail's account list) and tests a key on request. A key is never shown: a row says where it stands, not what it is.
 * "This Mac" has its own query and renders whatever the connections query is doing: a slow Mail must never hide the
 * autostart switch (measured 2026-11-19: skeletons only, for as long as Mail held its AppleEvents).
 */
export function ConnectionsView() {
  const now = useClock()();
  const q = useConnections();
  const { status, busy, test, save, remove } = useConnectionActions();
  const data = q.data;

  if (q.isPending)
    return (
      <>
        <ConnectionsSkeleton />
        <AutostartRow />
      </>
    );
  if (!data)
    return (
      <>
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the connections" />
        <AutostartRow />
      </>
    );
  if (data.connections.length === 0 && data.mail.length === 0)
    return (
      <>
        <EmptyState title="No connections yet">They appear here once a project is set up: say “настрой проект” in a session.</EmptyState>
        <AutostartRow />
      </>
    );
  return (
    <>
      <ConnectionGroup id="mail" title="Mail">
        <MailAccounts mail={data.mail} read={data.mailRead} />
      </ConnectionGroup>
      {groupByKind(data.connections).map((g) => (
        <ConnectionGroup id={g.kind} key={g.kind} title={KIND_TITLE[g.kind]}>
          <ul className="flex flex-col divide-y">
            {g.rows.map((r) => (
              <ConnectionRow actions={{ test: () => void test(r), save: (b) => save(r, b), remove: () => remove(r) }} busy={busy === r.id} key={r.id} locked={busy !== null} now={now} row={r} />
            ))}
          </ul>
        </ConnectionGroup>
      ))}
      {/* P67: how this instance starts on this Mac; it is the instance's, not a project's (rules README 8a). */}
      <AutostartRow />
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
