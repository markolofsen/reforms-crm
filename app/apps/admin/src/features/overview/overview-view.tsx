import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { useClock } from "@/lib/clock";
import { useOverview } from "@/lib/status";
import { ordered } from "./labels";
import { ProjectList, ProjectTable } from "./project-rows";

/**
 * Every project at a glance, for an instance with two or more: one sentence that counts the projects that need the owner,
 * then one row per project leading into its Drafts. Reads `GET /api/overview` (local facts only, refetched every minute);
 * nothing here reads Mail or Notion, so there is nothing to refresh by hand.
 */
export function OverviewView() {
  const now = useClock()();
  const q = useOverview();
  const data = q.data;
  if (q.isPending) return <ListSkeleton label="Loading the overview" rows={2} />;
  if (!data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the overview" />;
  if (data.projects.length === 0) return <EmptyState title="No projects yet">Ask the agent to set up your project: say “настрой проект” in a session.</EmptyState>;
  const rows = ordered(data.projects);
  return (
    <>
      <p className="font-medium text-base" data-testid="overview-sentence" role="status">
        {data.sentence}
      </p>
      <ProjectTable now={now} rows={rows} />
      <ProjectList now={now} rows={rows} />
      {q.isError && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
    </>
  );
}
