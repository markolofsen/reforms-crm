import { type ReactNode } from "react";
import { TONES, type Tone } from "@hub/config";
import { ActionButton } from "@hub/ui/product/action-button";
import { ToggleGroup, ToggleGroupItem } from "@hub/ui/toggle-group";
import { isClosed, type ReviewDraft } from "../source";
import type { DraftMailDto } from "@hub/contract/mail";
import type { ReviewActions } from "../use-review-actions";
import { mailProblem } from "../mail/tick-guard";
import { MailGone } from "../mail/mail-gone";
import { ConversationText } from "@hub/ui/product/conversation";

const TONE_LABEL: Record<Tone, string> = { short: "Short", standard: "Standard", warm: "Warm" };

function addressing(d: ReviewDraft): string {
  const who = d.toAddr.toLowerCase() === d.client.email.toLowerCase() ? (d.client.name.split(" ")[0] ?? d.client.name) : d.toAddr;
  const cc = d.ccAddr ? d.ccAddr.split(",").filter((x) => x.trim() !== "").length : 0;
  return `To ${who}${cc > 0 ? `, Cc ${cc}` : ""}, ${d.subject}`;
}

/**
 * P58: who the client will see the reply from and whom it goes to, from Mail's own read (true after an edit in Mail),
 * then the address they wrote to, as context: a reply from the mailbox a brand address forwards into is the design.
 */
function FromLine({ d, live }: { d: ReviewDraft; live: DraftMailDto }) {
  return (
    <p className="break-words text-muted-foreground text-sm" data-testid="from-line">
      From {live.from ?? "?"} → To {live.to.join(", ") || "nobody"}
      {live.cc.length > 0 ? `, Cc ${live.cc.join(", ")}` : ""}
      {d.wroteTo ? ` · they wrote to ${d.wroteTo}` : ""}
    </p>
  );
}

type EditingValue = { text: string; hash: string };
type Props = { d: ReviewDraft; project: string; actions: ReviewActions; /** What Mail holds, shown while the send is confirmed. */ confirmed: string | null; /** The text as Mail holds it now (read on demand), when it could be read. */ live?: DraftMailDto; /** Read Mail again: the quiet way out of state 12. */ onRead?: () => void; reading?: boolean; editing?: EditingValue | null; editor?: ReactNode; onEdit?: (value: EditingValue) => void };

function AddressDetails({ d }: { d: ReviewDraft }) {
  const facts = [d.ccAddr ? `Cc ${d.ccAddr}` : null, d.wroteTo ? `They wrote to ${d.wroteTo}` : null, d.brand ? `Brand ${d.brand}` : null].filter((fact): fact is string => fact !== null);
  if (facts.length === 0) return null;
  return <p className="break-words pb-1 text-muted-foreground text-xs" data-testid="address-details">{facts.join(" · ")}</p>;
}

/** The draft as a document: addressing, versions, the paper surface and owner actions. */
export function DraftBlock({ d, project, actions, confirmed, live, onRead, reading, editing = null, editor, onEdit }: Props) {
  const closed = isClosed(d);
  const tones = TONES.filter((t) => d.toneBodies[t] !== undefined);
  const readable = live?.found ? live : null;
  const unreadable = live?.configured === true && !live.found;
  // P87 (B4): a sent mail left Drafts by being sent; "deleted ... Restore" would offer to bring back a mail that went out.
  const sent = d.status === "sent" || d.sendState?.status === "sent" || d.sendState?.status === "sending";
  const gone = unreadable && !sent ? (live.gone ?? null) : null;
  // Exactly the Mail text (decision 0031): nothing of the Hub's is in it, so nothing is hidden.
  const body = confirmed ?? readable?.body ?? d.body;
  // The owner edits only a text Mail holds exactly once (a hash), on an open draft written to Mail (P56 S1).
  const editable = readable?.hash ? { hash: readable.hash } : null;
  const canEdit = editable !== null && !closed && d.status === "ready" && confirmed === null;
  return (
    <section aria-label="Draft" className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0">
        <p className="mb-1 font-medium text-sm">{addressing(d)}</p>
        <AddressDetails d={d} />
      </div>
      {tones.length > 1 && (
        <ToggleGroup aria-label="Version" onValueChange={(v) => { const t = TONES.find((x) => x === v[0]); if (t) actions.setTone(d, t); }} size="sm" value={[d.tone]} variant="outline">
          {tones.map((t) => (
            <ToggleGroupItem className="min-h-(--control-s) min-w-(--control-s)" disabled={closed || actions.pending} key={t} value={t}>
              {TONE_LABEL[t]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      {readable && <FromLine d={d} live={readable} />}
      {gone && <MailGone draftId={d.id} project={project} trashRef={gone.trashRef} />}
      {unreadable && !gone && !sent && (
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
        editor
      ) : body === "" ? (
        !unreadable && <p className="text-muted-foreground text-sm">The text of this mail is not stored here. Open it in Mail.</p>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          {(confirmed !== null || readable) && <p className="mb-2 text-muted-foreground text-xs">{confirmed !== null ? "Exactly as Mail holds it:" : "As Mail holds it now:"}</p>}
          {unreadable && confirmed === null && <p className="mb-2 text-muted-foreground text-xs">A preview stored with the draft (up to 240 characters), not what Mail holds:</p>}
          <ConversationText format="plain" text={body} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {editable && canEdit && editing === null && onEdit && (
          <ActionButton onClick={() => onEdit({ text: body, hash: editable.hash })} size="s" variant="quiet">
            Edit
          </ActionButton>
        )}
      </div>
    </section>
  );
}
