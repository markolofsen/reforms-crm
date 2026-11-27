import { ActionButton } from "@hub/ui/product/action-button";
import { SectionTitle } from "@hub/ui/product/shell/page";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { useWatchProposals } from "@/lib/data/watch/review";
import { PublicReplyCard } from "./card";
import { matchesReviewSource } from "./state";

/** One source's existing immutable proposals, inside its current Watch context. Opening this read creates nothing. */
export function PublicReplyReview({ project, direction, group, messageId }: { project: string; direction: string; group: string; messageId: number }) {
  const query = useWatchProposals(project, direction, group, messageId);
  const target = { project, direction, group, messageId };
  const refresh = async (): Promise<boolean> => {
    const result = await query.refetch();
    return !result.isError && result.data !== undefined && matchesReviewSource(result.data, target);
  };
  return (
    <section aria-labelledby="watch-public-replies" className="flex min-w-0 flex-col gap-3" data-testid="public-replies">
      <SectionTitle id="watch-public-replies">Public replies</SectionTitle>
      <QueryView query={query} what="the reviewed public replies" loading={<ListSkeleton label="Loading public replies" rows={2} />}>
        {(data) => !matchesReviewSource(data, target)
          ? <EmptyState title="The reply review returned a different source" action={<ActionButton onClick={() => void query.refetch()} size="s" variant="secondary">Retry</ActionButton>}>The selected source remains open. No reply from another source can be reviewed here.</EmptyState>
          : data.items.length === 0
            ? <EmptyState compact title="No reviewed reply for this message">Only saved, reviewed CRM proposals appear here. Opening this source prepares and sends nothing.</EmptyState>
            : <div className="flex min-w-0 flex-col gap-3">{data.items.map((review) => <PublicReplyCard key={review.proposal.id} readStale={query.isError} refresh={refresh} refreshing={query.isFetching} review={review} />)}</div>}
      </QueryView>
    </section>
  );
}
