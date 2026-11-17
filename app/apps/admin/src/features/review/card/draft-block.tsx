import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { TONES, type Tone } from "@hub/config";
import { ActionButton } from "@hub/ui/product/action-button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@hub/ui/toggle-group";
import { ThreadPanel } from "@/features/thread/thread-panel";
import { isClosed, type ReviewDraft } from "../source";
import type { DraftMailDto } from "@hub/contract/responses";
import type { ReviewActions } from "../use-review-actions";

const TONE_LABEL: Record<Tone, string> = { short: "Short", standard: "Standard", warm: "Warm" };

function addressing(d: ReviewDraft): string {
  const who = d.toAddr.toLowerCase() === d.client.email.toLowerCase() ? (d.client.name.split(" ")[0] ?? d.client.name) : d.toAddr;
  const cc = d.ccAddr ? d.ccAddr.split(",").filter((x) => x.trim() !== "").length : 0;
  return `To ${who}${cc > 0 ? `, Cc ${cc}` : ""}, ${d.subject}`;
}

type Props = { d: ReviewDraft; project: string; actions: ReviewActions; thread: boolean; onThread: () => void; /** What Mail holds, shown while the send is confirmed. */ confirmed: string | null; /** The text as Mail holds it now (read on demand), when it could be read. */ live?: DraftMailDto };

/** The draft as a document: one addressing line that opens, the versions, the paper surface, the thread under it. */
export function DraftBlock({ d, project, actions, thread, onThread, confirmed, live }: Props) {
  const [open, setOpen] = useState(false);
  const closed = isClosed(d);
  const tones = TONES.filter((t) => d.toneBodies[t] !== undefined);
  const readable = live?.found ? live : null;
  const unreadable = live?.configured === true && !live.found;
  const body = confirmed ?? readable?.body ?? d.body;
  return (
    <section aria-label="Draft" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Collapsible className="min-w-0 flex-1" onOpenChange={setOpen} open={open}>
          <CollapsibleTrigger className="flex min-h-(--control-s) w-full min-w-0 items-center gap-1 rounded-sm text-start text-muted-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="truncate">{addressing(d)}</span>
            <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pb-2 text-sm">
              <dt className="text-muted-foreground">To</dt>
              <dd className="break-all">{d.toAddr}</dd>
              {d.ccAddr && (
                <>
                  <dt className="text-muted-foreground">Cc</dt>
                  <dd className="break-all">{d.ccAddr}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Subject</dt>
              <dd className="break-words">{d.subject}</dd>
            </dl>
          </CollapsiblePanel>
        </Collapsible>
        {tones.length > 1 && (
          <ToggleGroup aria-label="Version" onValueChange={(v) => { const t = TONES.find((x) => x === v[0]); if (t) actions.setTone(d, t); }} size="sm" value={[d.tone]} variant="outline">
            {tones.map((t) => (
              <ToggleGroupItem className="min-h-(--control-s) min-w-(--control-s)" disabled={closed || actions.pending} key={t} value={t}>
                {TONE_LABEL[t]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
      {unreadable && <p className="text-sm text-warning-foreground" data-testid="mail-unreadable">Mail could not be read{live?.reason ? `: ${live.reason}` : ""}. Open it in Mail.</p>}
      {body === "" ? (
        !unreadable && <p className="text-muted-foreground text-sm">The text of this mail is not stored here. Open it in Mail.</p>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          {(confirmed !== null || readable) && <p className="mb-2 text-muted-foreground text-xs">{confirmed !== null ? "Exactly as Mail holds it:" : "As Mail holds it now:"}</p>}
          {unreadable && confirmed === null && <p className="mb-2 text-muted-foreground text-xs">Stored with the draft, not what Mail holds:</p>}
          <pre className="whitespace-pre-wrap break-words font-sans text-base sm:text-sm">{body}</pre>
        </div>
      )}
      <ActionButton aria-expanded={thread} className="self-start" onClick={onThread} size="s" variant="quiet">
        {thread ? "Hide thread" : "Thread"}
      </ActionButton>
      {thread && <ThreadPanel clientId={d.clientId} project={project} />}
    </section>
  );
}
