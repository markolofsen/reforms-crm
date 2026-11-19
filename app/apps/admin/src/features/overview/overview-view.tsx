import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { usePlace } from "@/hooks/use-project";
import { useClock } from "@/lib/clock";
import { useOverview } from "@/lib/status";
import { ordered } from "./labels";
import { ProjectList, ProjectTable } from "./project-rows";
import { SchemeBlock } from "./scheme";

/**
 * What needs you, on every instance (P63, P70). With two or more projects first one sentence that counts the projects that need
 * the owner and one row per project leading into its Drafts (list first); with one project neither (they would repeat the Drafts
 * status line). Then "Needs you" or "Everything works", and every part folded under "All parts". Reads `GET /api/overview`,
 * `GET /api/scheme` and each project's files (local state only); nothing here reads Notion or runs a check, so there is nothing
 * to refresh by hand: Settings ▸ Agent and ▸ Connections hold Refresh and Test.
 */
export function OverviewView() {
  const now = useClock()();
  const { multi } = usePlace();
  const q = useOverview();
  const data = q.data;
  if (q.isPending) return <ListSkeleton label="Loading the overview" rows={2} />;
  if (!data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the overview" />;
  if (data.projects.length === 0) return <EmptyState title="No projects yet">Ask the agent to set up your project: say “настрой проект” in a session.</EmptyState>;
  const rows = ordered(data.projects);
  return (
    <>
      {multi && (
        <>
          <p className="font-medium text-base" data-testid="overview-sentence" role="status">
            {data.sentence}
          </p>
          <ProjectTable now={now} rows={rows} />
          <ProjectList now={now} rows={rows} />
        </>
      )}
      {q.isError && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
      <SchemeBlock multi={multi} projects={rows.filter((p) => !p.archived).map((p) => p.slug)} />
    </>
  );
}
