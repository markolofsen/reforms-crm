import { ChevronDownIcon } from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { plural } from "@/lib/format";
import type { ReviewDraft } from "@/features/mail/model";

function List({ title, items }: { title: string; items: string[] | undefined }) {
  if (!items?.length) return null;
  return (
    <div>
      <h5 className="font-medium text-muted-foreground text-xs">{title}</h5>
      <ul className="list-disc ps-4 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

/**
 * "Based on": what the agent says it read before it wrote this draft (the context block the draft's record stored, `draft_write`):
 * the messages, the Notion profile, the facts, the anchors only this client has. Shown, never graded (P140 K2: the agent follows
 * the workflow). Nothing here is the reply text.
 */
export function BasedOnStrip({ d }: { d: ReviewDraft }) {
  const b = d.basedOn;
  if (!b) return null;
  const { thread, profile, facts, anchors, personalization } = b.context;
  const read = thread?.firstContact ? "First contact" : `${thread?.read ?? 0} of ${plural(thread?.found ?? 0, "message")} read`;
  return (
    <Collapsible className="rounded-lg border" data-testid="based-on">
      <CollapsibleTrigger className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-start text-sm">
        <span className="font-medium">Based on</span>
        <span className="min-w-0 flex-1 text-muted-foreground">
          {read}, profile {profile?.state ?? "not read"}, {plural(facts?.used?.length ?? 0, "fact")} used
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-3 border-t px-3 py-3">
          <List items={anchors} title="Only this client has" />
          {personalization && <p className="text-sm"><span className="text-muted-foreground">Made specific to them: </span>{personalization}</p>}
          <List items={facts?.used} title="Facts used" />
          <List items={facts?.missing} title="Facts missing" />
          <p className="text-muted-foreground text-xs">The versions (Short, Standard, Warm) change the tone, not what the reply is based on.</p>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
