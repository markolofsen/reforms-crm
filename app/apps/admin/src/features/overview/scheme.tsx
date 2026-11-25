import { useScheme } from "@/lib/data/overview";
import { ChevronDownIcon } from "lucide-react";
import { worstFirst } from "@hub/contract/scheme";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { ActionButton } from "@hub/ui/product/action-button";
import { ListSkeleton, QueryView } from "@/components/state-views";
import { NeedsYou, useQuestions } from "./needs-you";
import { useFollowUpNeeds, type FollowUpNeed } from "./follow-ups/today";
import { SchemeTable } from "./scheme-table";

/**
 * How the whole Hub stands (P63 O1, P70): "Needs you" (or "Everything works"), then every part under "All parts", closed: the
 * healthy ones and the ones "Not checked here" are one click away, never in view. Read from `GET /api/scheme` (the server's own
 * state, no check run) and refetched on the live topics its sources move. Patch B draws the parts under the folded table.
 */
export function SchemeBlock({ multi, projects }: { multi: boolean; projects: readonly string[] }) {
  const q = useScheme();
  const questions = useQuestions(projects);
  const followUps = useFollowUpNeeds(projects);
  return (
    <QueryView loading={<ListSkeleton label="Loading the parts" rows={4} />} query={q} what="the parts">
      {(d) => <SchemeParts followUps={followUps} multi={multi} nodes={worstFirst(d.nodes)} questions={questions} />}
    </QueryView>
  );
}

/** Needs you, then every part folded under All parts (the block above owns the read and its states). */
function SchemeParts({ multi, nodes, questions, followUps }: { multi: boolean; nodes: ReturnType<typeof worstFirst>; questions: ReturnType<typeof useQuestions>; followUps: readonly FollowUpNeed[] }) {
  return (
    <>
      <NeedsYou followUps={followUps} multi={multi} nodes={nodes} questions={questions} />
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
    </>
  );
}
