import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { worstFirst } from "@hub/contract/scheme";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { ActionButton } from "@hub/ui/product/action-button";
import { ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { overviewApi } from "@/lib/api/overview";
import { keys } from "@/lib/cache/keys";
import { NeedsYou, useQuestions } from "./needs-you";
import { SchemeTable } from "./scheme-table";

/**
 * How the whole Hub stands (P63 O1, P70): "Needs you" (or "Everything works"), then every part under "All parts", closed: the
 * healthy ones and the ones "Not checked here" are one click away, never in view. Read from `GET /api/scheme` (the server's own
 * state, no check run) and refetched on the live topics its sources move. Patch B draws the parts under the folded table.
 */
export function SchemeBlock({ multi, projects }: { multi: boolean; projects: readonly string[] }) {
  const q = useQuery({ queryKey: keys.scheme(), queryFn: overviewApi.scheme });
  const questions = useQuestions(projects);
  if (q.isPending) return <ListSkeleton label="Loading the parts" rows={4} />;
  if (!q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the parts" />;
  const nodes = worstFirst(q.data.nodes);
  return (
    <>
      <NeedsYou multi={multi} nodes={nodes} questions={questions} />
      <Collapsible>
        <CollapsibleTrigger className="group -ms-3 justify-start gap-2" render={<ActionButton size="m" variant="quiet" />}>
          All parts
          <span className="font-normal text-muted-foreground tabular-nums">{nodes.length}</span>
          <ChevronDownIcon aria-hidden="true" className="transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="pt-2">
            <SchemeTable multi={multi} nodes={nodes} />
          </div>
        </CollapsiblePanel>
      </Collapsible>
      {q.isError && <StaleNote error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
    </>
  );
}
