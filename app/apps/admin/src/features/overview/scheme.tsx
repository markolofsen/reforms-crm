import { useQuery } from "@tanstack/react-query";
import { worstFirst } from "@hub/contract/scheme";
import { ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { overviewApi } from "@/lib/api/overview";
import { keys } from "@/lib/cache/keys";
import { SchemeTable } from "./scheme-table";

/**
 * How the whole Hub stands (P63 O1): the parts table, read from `GET /api/scheme` (the server's own state, no check run) and
 * refetched on the live topics its sources move. Patch B draws the same parts as a scheme under this table.
 */
export function SchemeBlock({ multi }: { multi: boolean }) {
  const q = useQuery({ queryKey: keys.scheme(), queryFn: overviewApi.scheme });
  return (
    <section aria-labelledby="scheme-title" className="flex flex-col gap-2">
      <h3 className="font-heading font-medium text-sm" id="scheme-title">
        Parts of this Hub
      </h3>
      {q.isPending ? (
        <ListSkeleton label="Loading the parts" rows={4} />
      ) : !q.data ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the parts" />
      ) : (
        <SchemeTable multi={multi} nodes={worstFirst(q.data.nodes)} />
      )}
      {q.isError && q.data && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
    </section>
  );
}
