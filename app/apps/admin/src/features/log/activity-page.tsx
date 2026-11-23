import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ActivityDto } from "@hub/contract/activity";
import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/page";
import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { useSearch } from "@/hooks/use-search-state";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { useClock } from "@/lib/clock";
import { useSends } from "@/lib/status";
import { LOG_SEARCH, type ActivityView, type TimelineView } from "@/routes/search";
import { FilterMenu } from "./filter-menu";
import { SendsView } from "./sends-table";
import { Timeline } from "./timeline";
import { useNewRows } from "./use-new-rows";

type Props = { project: string; filter: ActivityView; client: number | null };
/** The first page has no cursor; each later one starts before the previous page's `next`. */
const FIRST_PAGE: string | null = null;

/** The timeline of one view (and one client), its pages one key (`state-and-data.md` rule 2): the newest 100, then Show older. */
function useTimeline(project: string, view: TimelineView, client: number | null) {
  const q = useInfiniteQuery({
    queryKey: keys.activity(project, view, client),
    queryFn: ({ pageParam }) => metaApi.activity(project, view, client, pageParam),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last: ActivityDto) => last.next ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  // "N new" counts what a live refetch adds at the top, so only the first page's rows are read (Show older adds none).
  const first = q.data?.pages[0];
  const ids = useMemo(() => (q.isPlaceholderData ? undefined : first?.rows.map((r) => r.id)), [first, q.isPlaceholderData]);
  return { q, rows, ids, head: first };
}

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
  const body = q.isPending ? (
    <ListSkeleton label="Loading the activity" />
  ) : !head ? (
    <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the activity" />
  ) : rows.length === 0 ? (
    view === "all" && client === null ? (
      <EmptyState title="Nothing yet">It fills in when the agent works in a session: what it decided for every client appears here, newest first.</EmptyState>
    ) : (
      <EmptyState action={<ActionButton onClick={() => setSearch({ filter: "all" })} size="s" variant="secondary">Show all</ActionButton>} title="Nothing in this view" />
    )
  ) : (
    <>
      <Timeline now={now} rows={rows} />
      {q.hasNextPage && (
        <ActionButton className="self-start" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} size="m" variant="secondary">
          Show older
        </ActionButton>
      )}
    </>
  );
  return (
    <>
      <p className="sr-only" data-testid="activity-new" role="status">
        {fresh}
      </p>
      {client !== null && <ClientLine name={head?.client?.name ?? "This client"} />}
      {body}
      {q.isError && head && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
    </>
  );
}

/**
 * What happened in one project (P73, decision 0037): one page, no detail pane (`admin-principles.md` rule 6), the View menu in
 * the header line (the timeline's counts are the server's; Sends counts the sends), then the timeline of what the agent
 * decided, newest first, or the send history. The view and the one client live in the address (`?filter=`, `?client=`).
 */
export function ActivityPage({ project, filter, client }: Props) {
  const [, setSearch] = useSearch(LOG_SEARCH);
  // The counts come with any view's reply; on Sends the All reply carries them (the same key as the All view, cached).
  const counts = useTimeline(project, filter === "sends" ? "all" : filter, filter === "sends" ? null : client).head?.counts;
  const sends = useSends(project);
  return (
    <Page actions={<FilterMenu counts={counts} onChange={(v) => setSearch({ filter: v })} sends={sends.data?.sends.length} value={filter} />}>
      {filter === "sends" ? <SendsView project={project} /> : <TimelineView client={client} project={project} view={filter} />}
    </Page>
  );
}
