import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ActionButton } from "@hub/ui/product/action-button";
import { ListDetail } from "@hub/ui/product/list-detail";
import { Page } from "@hub/ui/product/page";
import { EmptyState, ListSkeleton, LoadFailed, Loading, StaleNote } from "@/components/state-views";
import { useSearchState } from "@/hooks/use-search-state";
import { metaApi } from "@/lib/api/meta";
import type { RunFilter } from "@/routes/search";
import { FilterMenu } from "./filter-menu";
import { SessionDetail, SessionHint, SessionMissing } from "./session-detail";
import { SessionRows, SessionTable } from "./session-list";

export const activityKey = (project: string, filter: RunFilter) => ["activity", project, filter] as const;

type Props = { project: string; filter: RunFilter; run: number | null };

/** The table side: the View menu in the header line, then the sessions, in each of the four states of a list. */
function Sessions({ project, filter, run }: Props) {
  const setFilter = useSearchState("filter")[1];
  const q = useQuery({ queryKey: activityKey(project, filter), queryFn: () => metaApi.activity(project, filter), refetchInterval: 10_000, placeholderData: keepPreviousData });
  const data = q.data;
  const body = q.isPending ? (
    <ListSkeleton label="Loading the activity" />
  ) : !data ? (
    <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the activity" />
  ) : data.sessions.length === 0 ? (
    filter === "all" ? (
      <EmptyState title="Nothing yet">It fills in when the agent works in a session: each session and what it did for every client appears here.</EmptyState>
    ) : (
      <EmptyState action={<ActionButton onClick={() => setFilter("all")} size="s" variant="secondary">Show all</ActionButton>} title="No session in this view" />
    )
  ) : (
    <>
      <SessionTable filter={filter} open={run} sessions={data.sessions} />
      <SessionRows filter={filter} open={run} sessions={data.sessions} />
    </>
  );
  return (
    <Page actions={<FilterMenu counts={data?.counts} onChange={setFilter} value={filter} />}>
      {body}
      {q.isError && data && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
    </Page>
  );
}

/** The opened session, read from the same query as the table (one key, `state-and-data.md` rule 2). */
function Detail({ project, filter, run }: Props) {
  const q = useQuery({ queryKey: activityKey(project, filter), queryFn: () => metaApi.activity(project, filter), placeholderData: keepPreviousData });
  if (run === null) return <SessionHint />;
  const session = q.data?.sessions.find((s) => s.runId === run);
  if (session) return <SessionDetail filter={filter} session={session} />;
  if (q.data) return <SessionMissing filter={filter} />;
  return <Page>{q.isError ? <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the session" /> : <Loading what="the session" />}</Page>;
}

/**
 * What the agent did in one project: the sessions as a table (newest first) and, when the pane is wide enough for the split
 * (`ListDetail`), the opened one beside it as sentences; narrower, the session is its own screen. The view and the opened session live in the address (`?filter=`, `?run=`).
 */
export function ActivityPage(props: Props) {
  // The table is the subject here and the detail the aside, so the list takes two thirds (`wide`).
  return <ListDetail detail={<Detail {...props} />} detailLabel="Session" list={<Sessions {...props} />} listLabel="Sessions" showDetail={props.run !== null} wide />;
}
