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
import { mailProblem } from "../mail/tick-guard";
import { DraftEditor } from "../mail/draft-editor";
import { MailGone } from "../mail/mail-gone";

const TONE_LABEL: Record<Tone, string> = { short: "Short", standard: "Standard", warm: "Warm" };

function addressing(d: ReviewDraft): string {
  const who = d.toAddr.toLowerCase() === d.client.email.toLowerCase() ? (d.client.name.split(" ")[0] ?? d.client.name) : d.toAddr;
  const cc = d.ccAddr ? d.ccAddr.split(",").filter((x) => x.trim() !== "").length : 0;
  return `To ${who}${cc > 0 ? `, Cc ${cc}` : ""}, ${d.subject}`;
}

type Props = { d: ReviewDraft; project: string; actions: ReviewActions; thread: boolean; onThread: () => void; /** What Mail holds, shown while the send is confirmed. */ confirmed: string | null; /** The text as Mail holds it now (read on demand), when it could be read. */ live?: DraftMailDto; /** Read Mail again: the quiet way out of state 12. */ onRead?: () => void; reading?: boolean };

/** The draft as a document: one addressing line that opens, the versions, the paper surface, the thread under it. */
export function DraftBlock({ d, project, actions, thread, onThread, confirmed, live, onRead, reading }: Props) {
  const [open, setOpen] = useState(false);
  // What the editor opened from: the text and its hash, kept while live reads come and go (P56 S1).
  const [editing, setEditing] = useState<{ text: string; hash: string } | null>(null);
  const closed = isClosed(d);
  const tones = TONES.filter((t) => d.toneBodies[t] !== undefined);
  const readable = live?.found ? live : null;
  const unreadable = live?.configured === true && !live.found;
  const gone = unreadable ? (live.gone ?? null) : null;
  // Exactly the Mail text (decision 0031): nothing of the Hub's is in it, so nothing is hidden. A draft written before it
  // shows its old hub line until `hub drafts unmark` rewrites it, and Send refuses it meanwhile.
  const body = confirmed ?? readable?.body ?? d.body;
  // The owner edits only a text Mail holds exactly once (a hash), on an open draft written to Mail (P56 S1).
  const editable = readable?.hash ? { hash: readable.hash } : null;
  const canEdit = editable !== null && !closed && d.status === "ready" && d.batchId === null && confirmed === null;
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
              {(d.wroteTo || d.brand) && (
                <>
                  <dt className="text-muted-foreground">They wrote to</dt>
                  <dd className="break-all">{d.wroteTo ? `${d.wroteTo}${d.brand ? ` (${d.brand})` : ""}` : d.brand}</dd>
                </>
              )}
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
      {gone && <MailGone draftId={d.id} project={project} trashRef={gone.trashRef} />}
      {unreadable && !gone && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-warning-foreground" data-testid="mail-unreadable">{mailProblem(live?.reason)}. Open it in Mail.</p>
          {onRead && (
            <ActionButton disabled={reading} onClick={onRead} size="s" variant="quiet">
              {reading ? "Reading" : "Read again"}
            </ActionButton>
          )}
        </div>
      )}
      {live?.found && live.note && (
        <p className="text-sm text-warning-foreground" data-testid="mail-versions">
          {live.note}
        </p>
      )}
      {live?.found && live.aside && <p className="text-muted-foreground text-sm">{live.aside}</p>}
      {editing !== null ? (
        <DraftEditor draftId={d.id} hash={editing.hash} liveHash={readable?.hash ?? null} onClose={() => setEditing(null)} project={project} text={editing.text} />
      ) : body === "" ? (
        !unreadable && <p className="text-muted-foreground text-sm">The text of this mail is not stored here. Open it in Mail.</p>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          {(confirmed !== null || readable) && <p className="mb-2 text-muted-foreground text-xs">{confirmed !== null ? "Exactly as Mail holds it:" : "As Mail holds it now:"}</p>}
          {unreadable && confirmed === null && <p className="mb-2 text-muted-foreground text-xs">A preview stored with the draft (up to 240 characters), not what Mail holds:</p>}
          <pre className="whitespace-pre-wrap break-words font-sans text-base sm:text-sm">{body}</pre>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {editable && canEdit && editing === null && (
          <ActionButton onClick={() => setEditing({ text: body, hash: editable.hash })} size="s" variant="quiet">
            Edit
          </ActionButton>
        )}
        <ActionButton aria-expanded={thread} onClick={onThread} size="s" variant="quiet">
          {thread ? "Hide thread" : "Thread"}
        </ActionButton>
      </div>
      {thread && <ThreadPanel clientId={d.clientId} project={project} />}
    </section>
  );
}
