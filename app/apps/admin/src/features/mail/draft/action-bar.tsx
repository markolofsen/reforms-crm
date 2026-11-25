import { EllipsisIcon } from "lucide-react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@hub/ui/menu";
import { DraftActionRow, DraftSendButton } from "@hub/ui/product/conversation/draft-action-row";
import { formatTime } from "@/lib/format";
import { hrefOf } from "@hub/contract/local";
import { LocalActionButton, LocalActionItem } from "@/components/local-action";
import { SKIP_REASONS, type ReviewDraft } from "@/features/mail/model";
import type { ReviewActions } from "@/features/mail/list/use-review-actions";
import { canCheck, primaryFor, secondaryFor, type CardState, type Context, type Secondary } from "./card-state";

export type Handlers = {
  /** Opens the review dialog (P105); the dialog's Send sends. */
  send: () => void;
  /** Opens the review dialog in its Check mode, for Send all Checked of the batch. */
  check: () => void;
  uncheck: () => void;
  skip: (reason?: string) => void;
  done: () => void;
  hold: () => void;
  resume: () => void;
  reopen: () => void;
  cancelSend: () => void;
  copySubject: () => void;
  history: () => void;
};

type Props = {
  d: ReviewDraft;
  state: CardState;
  actions: ReviewActions;
  context: Context;
  on: Handlers;
  /** P58 R1: the Mail draft's own Message-ID when the read found the one draft (`draftLinkOf`), else null. */ draftLink?: string | null;
  /** P147 3m item 2: Edit beside Send, while Mail holds the text once and the draft is open (`editStartOf`); null: no Edit. */
  onEdit?: (() => void) | null;
};

/** The client's message has a `message:` link (the registry's `mail.openMessage`): a Message-ID, not a Mail draft id. */
export const hasMailLink = (d: Pick<ReviewDraft, "mailRef">): boolean => d.mailRef !== null && hrefOf("mail.openMessage", { messageId: d.mailRef }) !== null;

const OPEN_STATES: readonly CardState[] = ["checks_open", "unread", "acknowledged", "failed", "suspicious", "no_contact", "unreadable", "follow_up"];

/**
 * P58 R1, P105 verdict 3: Open the draft in Mail when the read found the one draft (its own Message-ID); else Open their message
 * (`message://` of the mailRef); else a plain Copy, so the button is never dead.
 */
function MailButton({ d, draftLink, variant, onCopy }: { d: ReviewDraft; draftLink: string | null; variant: "primary" | "secondary"; onCopy: () => void }) {
  if (draftLink) return <LocalActionButton action="mail.openDraft" args={{ messageId: draftLink }} size="m" variant={variant} />;
  return hasMailLink(d) ? (
    <LocalActionButton action="mail.openMessage" args={{ messageId: d.mailRef ?? "" }} size="m" variant={variant} />
  ) : (
    <ActionButton onClick={onCopy} size="m" variant={variant}>
      Copy subject to find in Mail
    </ActionButton>
  );
}

function MoreMenu({ d, state, actions, on, draftLink }: { d: ReviewDraft; state: CardState; actions: ReviewActions; on: Handlers; draftLink: string | null }) {
  const open = OPEN_STATES.includes(state);
  const skips = secondaryFor(state).includes("skip");
  const hasLink = hasMailLink(d);
  if (!open && !d.canUndo && d.runId === null && !hasLink) return null;
  return (
    <Menu>
      <MenuTrigger render={<ActionButton aria-label="More actions" icon size="m" tooltip="More actions" variant="quiet" />}>
        <EllipsisIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start" side="top">
        {open && <MenuItem disabled={actions.pending} onClick={on.hold}>Hold for later</MenuItem>}
        {open && <MenuItem disabled={actions.pending} onClick={on.done}>Mark done (handled in Mail)</MenuItem>}
        {/* P105 verdict 5: Checked stays for Send all Checked of a batch; on is reviewed in the dialog, off is at once. */}
        {d.batchId !== null && canCheck(state) && (d.checked ? <MenuItem disabled={actions.pending} onClick={on.uncheck}>Uncheck (leave Send all Checked)</MenuItem> : <MenuItem disabled={actions.pending} onClick={on.check}>Check for Send all Checked…</MenuItem>)}
        {skips && SKIP_REASONS.map((r) => <MenuItem disabled={actions.pending} key={r} onClick={() => on.skip(r)}>Skip: {r}</MenuItem>)}
        {(open || skips) && <MenuSeparator />}
        {d.canUndo && <MenuItem disabled={actions.pending} onClick={() => actions.undo(d)}>Undo last action</MenuItem>}
        {/* P73: the client's own timeline in Activity (`?client=`), whatever run wrote the draft. */}
        <MenuItem onClick={on.history}>See what the assistant did</MenuItem>
        {hasLink && draftLink && <LocalActionItem action="mail.openMessage" args={{ messageId: d.mailRef ?? "" }} />}
        {hasLink && <MenuItem onClick={on.copySubject}>Copy subject</MenuItem>}
      </MenuPopup>
    </Menu>
  );
}

/**
 * The only place with buttons, on the shared draft action row (P105, P127 C3): frequent and reversible on the left, the ONE
 * primary on the right. Send opens the review dialog, so it is never disabled and never asks a second time in the bar. Its parent
 * composer owns the fixed bottom dock, so this component only owns action semantics and layout inside it.
 */
export function ActionBar({ d, state, actions, context, on, draftLink = null, onEdit = null }: Props) {
  const primary = primaryFor(state, context);
  const secondary = (s: Secondary) => {
    switch (s) {
      case "skip":
        return <ActionButton disabled={actions.pending} key={s} onClick={() => on.skip()} size="m" variant="quiet">Skip</ActionButton>;
      case "open_mail":
        return primary?.action === "open_mail" ? null : <MailButton d={d} draftLink={draftLink} key={s} onCopy={on.copySubject} variant="secondary" />;
      case "cancel_send":
        return <ActionButton disabled={actions.pending} key={s} onClick={on.cancelSend} size="m" variant="danger">Cancel send</ActionButton>;
      case "reopen":
        return <ActionButton disabled={actions.pending} key={s} onClick={on.reopen} size="m" variant="secondary">Reopen</ActionButton>;
    }
  };
  const main =
    primary === null ? null : primary.action === "open_mail" ? (
      <MailButton d={d} draftLink={draftLink} onCopy={on.copySubject} variant="primary" />
    ) : primary.action === "send" ? (
      <DraftSendButton busy={primary.busy} onClick={on.send} who={context.name} />
    ) : (
      <ActionButton disabled={actions.pending} onClick={on.resume} size="m" variant="primary">{primary.label}</ActionButton>
    );
  return (
    <DraftActionRow
      note={state === "queued" && d.sendState?.dueAt ? <p className="text-muted-foreground text-sm">Goes out {formatTime(d.sendState.dueAt)}. Nothing else to do here.</p> : undefined}
      primary={main}
      start={
        <>
          {onEdit && (
            <ActionButton data-testid="draft-edit" disabled={actions.pending} onClick={onEdit} size="m" variant="secondary">
              Edit
            </ActionButton>
          )}
          {secondaryFor(state).map(secondary)}
          {state !== "sending" && <MoreMenu actions={actions} d={d} draftLink={draftLink} on={on} state={state} />}
        </>
      }
    />
  );
}
