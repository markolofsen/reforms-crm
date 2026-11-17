import { useQuery } from "@tanstack/react-query";
import { type EventKind } from "@hub/config";
import type { EventDto } from "@hub/contract/responses";
import { LoadFailed, Loading } from "@/components/state-views";
import { Badge } from "@hub/ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { metaApi } from "@/lib/api/meta";
import { formatClock } from "@/lib/format";

const KIND: Record<EventKind, { label: string; variant: "outline" | "info" | "success" | "warning" | "error" | "secondary" }> = {
  thought: { label: "Thought", variant: "outline" },
  tool_call: { label: "Tool", variant: "secondary" },
  tool_result: { label: "Result", variant: "secondary" },
  decision: { label: "Decision", variant: "info" },
  draft_created: { label: "Draft", variant: "success" },
  notion_write: { label: "Notion", variant: "success" },
  needs_human: { label: "Needs you", variant: "warning" },
  error: { label: "Error", variant: "error" },
};

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function EventItem({ event: e }: { event: EventDto }) {
  const kind = KIND[e.kind];
  return (
    <li className="flex gap-3 text-sm">
      <span className="w-16 shrink-0 pt-0.5 text-muted-foreground tabular-nums text-xs">{formatClock(e.at)}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge size="sm" variant={kind.variant}>
            {kind.label}
          </Badge>
          {e.tool && <code className="text-muted-foreground text-xs">{e.tool}</code>}
          {e.clientName && <span className="text-muted-foreground text-xs">{e.clientName}</span>}
        </div>
        <p className="break-words">{e.summary}</p>
        {e.detail && (
          <Collapsible>
            <CollapsibleTrigger className="inline-flex text-muted-foreground text-xs underline-offset-4 hover:underline min-h-(--control-s) min-w-(--control-s) items-center">Detail</CollapsibleTrigger>
            <CollapsiblePanel>
              <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">{pretty(e.detail)}</pre>
            </CollapsiblePanel>
          </Collapsible>
        )}
      </div>
    </li>
  );
}

/** The events of one run, in order. */
export function RunEvents({ project, runId }: { project: string; runId: number }) {
  const q = useQuery({ queryKey: ["events", project, runId], queryFn: () => metaApi.events(project, runId) });
  if (q.isPending) return <Loading what="events" />;
  if (q.isError) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="events" />;
  if (q.data.events.length === 0) return <p className="text-muted-foreground text-sm">No events were recorded for this run.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {q.data.events.map((e) => (
        <EventItem event={e} key={e.id} />
      ))}
    </ol>
  );
}

