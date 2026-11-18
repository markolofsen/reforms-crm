import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeftIcon, ArrowUpRightIcon } from "lucide-react";
import type { HistoryItemDto } from "@hub/contract/responses";
import { LoadFailed, Loading } from "@/components/state-views";
import { reviewApi } from "@/lib/api/review";
import { formatTime } from "@/lib/format";

function Item({ item }: { item: HistoryItemDto }) {
  const Icon = item.direction === "in" ? ArrowDownLeftIcon : ArrowUpRightIcon;
  return (
    <li className="flex min-w-0 gap-2 text-sm">
      <Icon aria-label={item.direction === "in" ? "From them" : "From us"} className="mt-0.5 size-4 shrink-0 text-muted-foreground" role="img" />
      <span className="min-w-0 flex-1 break-words">
        <span className="line-clamp-2">{item.text}</span>
        <span className="text-muted-foreground text-xs">
          {item.channel} · {formatTime(item.at)}
        </span>
      </span>
    </li>
  );
}

/**
 * One client's thread: the stored messenger rows, newest first, then what the agent and the owner did. It is fetched only
 * when opened. The mail itself is read in Mail (the card's Open in Mail): the Hub keeps no mail login since P48 (decision 0026).
 */
export function ThreadPanel({ project, clientId }: { project: string; clientId: number }) {
  const history = useQuery({ queryKey: ["thread", project, clientId], queryFn: () => reviewApi.history(project, clientId) });
  const timeline = useQuery({ queryKey: ["timeline", project, clientId], queryFn: () => reviewApi.timeline(project, clientId) });
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/40 p-3">
      <section aria-label="Messages" className="flex flex-col gap-2">
        <h3 className="font-medium text-sm">Messages</h3>
        {history.isPending ? (
          <Loading what="the thread" />
        ) : history.isError ? (
          <LoadFailed error={history.error} onRetry={() => void history.refetch()} retrying={history.isFetching} what="the thread" />
        ) : (
          <>
            {history.data.items.length === 0 ? <p className="text-muted-foreground text-sm">No messenger messages. The mail is in Mail.</p> : <ul className="flex flex-col gap-2">{history.data.items.slice(0, 20).map((i) => <Item item={i} key={i.key} />)}</ul>}
          </>
        )}
      </section>
      <section aria-label="Agent activity" className="flex flex-col gap-1.5">
        <h3 className="font-medium text-sm">What was done</h3>
        {timeline.isPending ? (
          <Loading what="the activity" />
        ) : timeline.isError ? (
          <LoadFailed error={timeline.error} onRetry={() => void timeline.refetch()} retrying={timeline.isFetching} what="the activity" />
        ) : timeline.data.events.length === 0 ? (
          <p className="text-muted-foreground text-sm">The agent has not touched this client.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {timeline.data.events.slice(0, 10).map((e) => (
              <li className="break-words text-sm" key={e.id}>
                {e.summary} <span className="text-muted-foreground text-xs">{formatTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
