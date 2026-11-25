import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/shell/page";
import { SectionLayout } from "@hub/ui/product/shell/section-layout";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { useSearch } from "@/hooks/use-search-state";
import { useClock } from "@/lib/clock";
import { useFollowUps, useSends, useTimeline } from "@/lib/data/project";
import { useOpsLines } from "@/lib/data/overview";
import { isLogView, LOG_SEARCH, type ActivityView, type TimelineView } from "@/routes/search";
import { ErrorsView } from "./errors/errors-view";
import { FollowUpsView } from "./follow-ups/table";
import { KindNav } from "./kind-nav";
import { SendsView } from "./sends-table";
import { Timeline } from "./timeline";
import { useNewRows } from "./use-new-rows";

type Props = { project: string; kind: ActivityView; client: number | null };
/** "Mark Effect only · Show all": the one-client narrowing (`?client=`), said once under the header line. */
function ClientLine({ name }: { name: string }) {
  const [, setSearch] = useSearch(LOG_SEARCH);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="activity-client">
      <span>{name} only</span>
      <ActionButton onClick={() => setSearch({ client: null })} size="s" variant="quiet">Show all</ActionButton>
    </p>
  );
}

/** The timeline of a view, in each of the four states of a list, and its last page's Show older. */
function TimelineView({ project, view, client }: { project: string; view: TimelineView; client: number | null }) {
  const [, setSearch] = useSearch(LOG_SEARCH);
  const now = useClock()();
  const { q, rows, ids, head } = useTimeline(project, view, client);
  const fresh = useNewRows(`${project}/${view}/${client ?? ""}`, ids);
  const empty =
    view === "all" && client === null ? (
      <EmptyState title="Nothing yet">It fills in when the agent works in a session: what it decided for every client appears here, newest first.</EmptyState>
    ) : (
      <EmptyState action={<ActionButton onClick={() => setSearch({ kind: "all" })} size="s" variant="secondary">Show all</ActionButton>} title="Nothing in this view" />
    );
  return (
    <>
      <p className="sr-only" data-testid="activity-new" role="status">
        {fresh}
      </p>
      {client !== null && <ClientLine name={head?.client?.name ?? "This client"} />}
      <QueryView empty={empty} isEmpty={() => rows.length === 0} loading={<ListSkeleton label="Loading the activity" />} query={q} what="the activity">
        {() => (
          <>
            <Timeline now={now} rows={rows} />
            {q.hasNextPage && (
              <ActionButton className="self-start" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} size="m" variant="secondary">
                Show older
              </ActionButton>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}

/**
 * What happened in one project (P73, decision 0037): one page, no detail pane (`admin-principles.md` rule 6), the kinds in the
 * menu column (P125 L3; the timeline's counts are the server's, Sends counts the sends), then the timeline of what the agent
 * decided, newest first, or the send history. The kind and the one client live in the address (`?kind=`, `?client=`).
 */
export function ActivityPage({ project, kind, client }: Props) {
  // The counts come with any view's reply; on Sends the All reply carries them (the same key as the All view, cached).
  const counts = useTimeline(project, isLogView(kind) ? "all" : kind, isLogView(kind) ? null : client).head?.counts;
  const sends = useSends(project);
  const followUps = useFollowUps(project);
  const lines = useOpsLines();
  return (
    <SectionLayout nav={<KindNav client={client} counts={counts} errors={lines.data?.errors} followUps={followUps.data?.rows.length} sends={sends.data?.sends.length} value={kind} />} navButton="Kinds" navLabel="Activity kinds">
      <Page label="Activity list">{kind === "sends" ? <SendsView project={project} /> : kind === "follow-ups" ? <FollowUpsView project={project} /> : kind === "errors" ? <ErrorsView /> : <TimelineView client={client} project={project} view={kind} />}</Page>
    </SectionLayout>
  );
}
