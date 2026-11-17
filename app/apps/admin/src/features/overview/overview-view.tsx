import { useEffect } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { OverviewDto } from "@hub/contract/overview";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { EmptyState, LoadFailed, StaleNote } from "@/components/state-views";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { Skeleton } from "@hub/ui/skeleton";
import { statusRows } from "@/features/shell/status-footer";
import { useClock } from "@/lib/clock";
import { ago, hhmm, plural } from "@/lib/format";
import { paths } from "@/routes/paths";
import { AttentionList } from "./attention-list";
import { ProjectCard } from "./project-card";
import { useOverview, useRefresh } from "./use-overview";
import { Verdict } from "./verdict";

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the overview" className="flex flex-col gap-4" role="status">
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 min-[960px]:grid-cols-2">
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** The system row at the foot: logins, Sent detection, messengers. Open when something is wrong, closed when all is well. */
function System({ system }: { system: OverviewDto["system"] }) {
  const rows = statusRows({ health: system, stale: false, serverOlder: false, serverNewer: false });
  const abnormal = rows.some((r) => r.tone === "bad" || r.tone === "warn");
  return (
    <Collapsible defaultOpen={abnormal}>
      <CollapsibleTrigger render={<ActionButton size="s" variant="quiet" />}>System</CollapsibleTrigger>
      <CollapsiblePanel>
        <ul aria-label="System" className="flex flex-col gap-1 pt-2 text-sm">
          {rows.map((r) => (
            <li key={r.text}>{r.text}</li>
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * Every project at a glance. Reads `GET /api/overview` (local facts and the cached live numbers; no network). Mail and
 * Notion are read only when asked: Refresh per card and Refresh all, one at a time, with the result in one live region.
 */
export function OverviewView({ focus }: { focus: string | null }) {
  const now = useClock()();
  const q = useOverview();
  const { status, busy, refresh, refreshAll } = useRefresh();
  const data = q.data;
  const target = data?.projects.some((p) => p.slug === focus) ? focus : null;
  const loaded = data !== undefined;
  useEffect(() => {
    if (target && loaded) document.getElementById(`project-${target}`)?.scrollIntoView({ block: "start" });
  }, [target, loaded]);

  const header = (
    <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-background px-4 py-2 sm:-mx-6 sm:px-6">
      <h3 className="font-heading font-medium text-lg">Overview</h3>
      <p className="me-auto text-muted-foreground text-xs">
        {!data ? "" : data.oldestAsOf ? `Live numbers read as of ${hhmm(data.oldestAsOf)} (${ago(data.oldestAsOf, now)})` : "No live number has been read yet"}
      </p>
      <ActionButton aria-busy={busy !== null} disabled={!data || busy !== null} onClick={() => data && void refreshAll(data.projects)} size="m" variant="secondary">
        <RefreshCwIcon aria-hidden="true" />
        Refresh all
      </ActionButton>
    </div>
  );
  // One live region for every refresh: a result is a status, a failure an alert.
  const notice = (
    <div className="min-h-5 text-sm">
      <p role="status">{status?.kind === "status" ? status.text : ""}</p>
      <p className="text-destructive-foreground" role="alert">
        {status?.kind === "alert" ? status.text : ""}
      </p>
    </div>
  );

  if (q.isPending) return <>{header}<OverviewSkeleton /></>;
  if (!data) return <>{header}<LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the overview" /></>;
  if (data.projects.length === 0) {
    return (
      <>
        {header}
        <EmptyState action={<AppLink to={paths.project.page()}>Open Project</AppLink>} title="No projects yet">
          Run `hub project sync` after setting one up (skill project-setup).
        </EmptyState>
      </>
    );
  }
  const active = data.projects.filter((p) => !p.archived);
  const archived = data.projects.filter((p) => p.archived);
  const card = (p: OverviewDto["projects"][number]) => <ProjectCard focused={p.slug === target} key={p.slug} locked={busy !== null} now={now} onRefresh={() => void refresh(p)} p={p} reading={busy === p.slug} />;
  return (
    <>
      {header}
      {notice}
      {q.isError && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
      {data.system.mailer === "fake" && <p className="text-muted-foreground text-sm">Test mode: sends stay inside this app.</p>}
      <Verdict verdict={data.verdict} />
      <AttentionList items={data.attention} />
      <div className="grid grid-cols-1 gap-4 min-[960px]:grid-cols-2">{active.map(card)}</div>
      {archived.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger render={<ActionButton size="s" variant="quiet" />}>{`Archived (${archived.length})`}</CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="grid grid-cols-1 gap-4 pt-2 min-[960px]:grid-cols-2">{archived.map(card)}</div>
          </CollapsiblePanel>
        </Collapsible>
      )}
      <System system={data.system} />
      <p className="text-muted-foreground text-xs">{plural(data.projects.length, "project")}. Nothing here sends mail or writes to Mail or Notion.</p>
    </>
  );
}
