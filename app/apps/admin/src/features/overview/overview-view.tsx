import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { phrase } from "@hub/contract/help";
import { usePlace } from "@/hooks/use-project";
import { useClock } from "@/lib/clock";
import { useOverview } from "@/lib/data/overview";
import { ordered } from "./labels";
import { ProjectList, ProjectTable } from "./project-rows";
import { RecentErrors } from "./recent-errors";
import { SchemeBlock } from "./scheme";

/**
 * What needs you, on every instance (P63, P70). With two or more projects first one sentence that counts the projects that need
 * the owner and one row per project leading into its Mail (list first); with one project neither (they would repeat the Mail
 * status line). Then "Needs you" or "Everything works", every part folded under "All parts", and the ops log's Recent errors folded
 * under it (P86, only when there is one). Reads `GET /api/overview`, `GET /api/ops/errors`,
 * `GET /api/scheme` and each project's files (local state only); nothing here reads Notion or runs a check, so there is nothing
 * to refresh by hand: Settings ▸ Agent and ▸ Connections hold Refresh and Test.
 */
export function OverviewView() {
  const now = useClock()();
  const { multi } = usePlace();
  const q = useOverview();
  return (
    <QueryView
      empty={<EmptyState title="No projects yet">Ask the agent to set up your project: say “{phrase("project-setup")}” in a session.</EmptyState>}
      isEmpty={(d) => d.projects.length === 0}
      loading={<ListSkeleton label="Loading the overview" rows={2} />}
      query={q}
      what="the overview"
    >
      {(data) => {
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
      <SchemeBlock multi={multi} projects={rows.filter((p) => !p.archived).map((p) => p.slug)} />
      <RecentErrors now={now} />
    </>
        );
      }}
    </QueryView>
  );
}
