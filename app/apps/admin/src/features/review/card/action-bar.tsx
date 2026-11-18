import { EllipsisIcon, SendIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Alert, AlertDescription, AlertTitle } from "@hub/ui/alert";
import { Link } from "@hub/ui/link";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@hub/ui/menu";
import { Switch } from "@hub/ui/switch";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { formatTime } from "@/lib/format";
import { mailLink } from "@/lib/mail";
import { isClosed, SKIP_REASONS, type ReviewDraft } from "../source";
import type { ReviewActions } from "../use-review-actions";
import { hasSwitch, primaryFor, secondaryFor, type CardState, type Context, type Secondary } from "./card-state";
import type { SendFlow } from "./use-send-flow";

export type Handlers = {
  send: () => void;
  confirm: () => void;
  cancelFlow: () => void;
  skip: (reason?: string) => void;
  done: () => void;
  hold: () => void;
  resume: () => void;
  reopen: () => void;
  replyMail: () => void;
  cancelSend: () => void;
  copySubject: () => void;
  history: () => void;
  blocked: (reason: string) => void;
};

type Props = { d: ReviewDraft; state: CardState; flow: SendFlow; actions: ReviewActions; context: Context; on: Handlers; /** Hash of the Mail text the person has read: ticking Checked binds to it. */ mailHash?: string | null; /** Why Checked cannot be switched on now (`mail/tick-guard.ts`), or null. */ tickBlock?: string | null };

const OPEN_STATES: readonly CardState[] = ["checks_open", "unread", "acknowledged", "batch", "failed", "suspicious", "no_contact", "unreadable", "follow_up"];

/** Open in Mail when there is a `message://` link; otherwise a plain Copy, so the button is never dead. */
function MailButton({ d, variant, onCopy }: { d: ReviewDraft; variant: "primary" | "secondary"; onCopy: () => void }) {
  const link = mailLink(d.mailRef);
  return link ? (
    <ActionButton render={<Link bare href={link} />} size="m" variant={variant}>
      Open in Mail
    </ActionButton>
  ) : (
    <ActionButton onClick={onCopy} size="m" variant={variant}>
      Copy subject to find in Mail
    </ActionButton>
  );
}

function MoreMenu({ d, state, actions, on }: { d: ReviewDraft; state: CardState; actions: ReviewActions; on: Handlers }) {
  const open = OPEN_STATES.includes(state);
  const skips = secondaryFor(state).includes("skip");
  const hasLink = mailLink(d.mailRef) !== null;
  if (!open && !d.canUndo && d.runId === null && !hasLink) return null;
  return (
    <Menu>
      <MenuTrigger render={<ActionButton aria-label="More actions" icon size="m" variant="quiet" />}>
        <EllipsisIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start" side="top">
        {open && <MenuItem disabled={actions.pending} onClick={on.hold}>Hold for later</MenuItem>}
        {open && <MenuItem disabled={actions.pending} onClick={on.done}>Mark done (handled in Mail)</MenuItem>}
        {skips && SKIP_REASONS.map((r) => <MenuItem disabled={actions.pending} key={r} onClick={() => on.skip(r)}>Skip: {r}</MenuItem>)}
        {(open || skips) && (d.canUndo || d.runId !== null || hasLink) && <MenuSeparator />}
        {d.canUndo && <MenuItem disabled={actions.pending} onClick={() => actions.undo(d)}>Undo last action</MenuItem>}
        {d.runId !== null && <MenuItem onClick={on.history}>See what the assistant did</MenuItem>}
        {hasLink && <MenuItem onClick={on.copySubject}>Copy subject</MenuItem>}
      </MenuPopup>
    </Menu>
  );
}

/** A refused or failed send is listed whole, above the bar, with what to do; the bar never hides it. */
export function SendNotices({ flow, onClose }: { flow: SendFlow; onClose: () => void }) {
  if (flow.step === "refused")
    return (
      <Alert variant="warning">
        <AlertTitle>
          Not sent: {flow.reasons.length} reason{flow.reasons.length === 1 ? "" : "s"}
        </AlertTitle>
        <AlertDescription>
          <ul className="list-disc ps-5">{flow.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <ActionButton className="mt-2" onClick={onClose} size="s" variant="secondary">Close</ActionButton>
        </AlertDescription>
      </Alert>
    );
  if (flow.step === "failed")
    return (
      <Alert variant="error">
        <AlertTitle>The send failed</AlertTitle>
        <AlertDescription>
          {flow.message}
          <ActionButton className="mt-2" onClick={onClose} size="s" variant="secondary">Close</ActionButton>
        </AlertDescription>
      </Alert>
    );
  return null;
}

/**
 * The only place with buttons: frequent and reversible on the left, the gate and the ONE primary on the right.
 * Confirming swaps the content in place (the primary keeps its place, focus on it, Esc cancels). It sticks to the
 * bottom of the pane, so Send is always in reach.
 */
export function ActionBar({ d, state, flow, actions, context, on, mailHash, tickBlock = null }: Props) {
  const primary = primaryFor(state, context);
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state === "confirming") primaryRef.current?.focus();
  }, [state]);
  // Esc cancels the confirm (the bar is swapped in place, so there is no dialog to close).
  useHotkeys({ escape: () => on.cancelFlow() }, state === "confirming");
  const press = () => {
    if (!primary) return;
    if (!primary.enabled || primary.busy) return primary.reason ? on.blocked(primary.reason) : undefined;
    const run = { send: on.send, confirm: on.confirm, resume: on.resume, open_mail: on.copySubject, reply_mail: on.replyMail }[primary.action];
    run();
  };
  const mail = flow.step === "confirm" || flow.step === "sending" ? flow.mail : null;
  const secondary = (s: Secondary) => {
    switch (s) {
      case "skip":
        return <ActionButton disabled={actions.pending} key={s} onClick={() => on.skip()} size="m" variant="quiet">Skip</ActionButton>;
      case "open_mail":
        return primary?.action === "open_mail" ? null : <MailButton d={d} key={s} onCopy={on.copySubject} variant="secondary" />;
      case "cancel":
        return <ActionButton key={s} onClick={on.cancelFlow} size="m" variant="quiet">Cancel</ActionButton>;
      case "cancel_send":
        return <ActionButton disabled={actions.pending} key={s} onClick={on.cancelSend} size="m" variant="danger">Cancel send</ActionButton>;
      case "reopen":
        return <ActionButton disabled={actions.pending} key={s} onClick={on.reopen} size="m" variant="secondary">Reopen</ActionButton>;
    }
  };
  const primaryMail = primary?.action === "open_mail";
  return (
    <div
      className="sticky bottom-0 z-10 flex flex-col gap-2 border-t bg-background px-4 py-3 lg:px-6"
      role="group"
      aria-label="Actions"
    >
      {state === "queued" && d.sendState?.dueAt && <p className="text-muted-foreground text-sm">Goes out {formatTime(d.sendState.dueAt)}. Nothing else to do here.</p>}
      {mail && (
        <p className="text-sm" role="status">
          To {mail.to.join(", ")}
          {mail.cc.length > 0 ? `, ${mail.cc.length} Cc` : ""}: {mail.subject}. A sent mail cannot be recalled.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {secondaryFor(state).map(secondary)}
        {state !== "confirming" && state !== "sending" && <MoreMenu actions={actions} d={d} on={on} state={state} />}
        <div className="ms-auto flex items-center gap-3">
          {hasSwitch(state) && !isClosed(d) && (
            <label className="flex min-h-(--control-m) items-center gap-2 text-sm" htmlFor={`ack-${d.id}`}>
              <Switch checked={d.checked} aria-describedby={tickBlock ? `tick-${d.id}` : undefined} disabled={actions.pending || (d.blocked && !d.checked) || tickBlock !== null} id={`ack-${d.id}`} onCheckedChange={(on_) => actions.setChecked(d, on_, mailHash)} />
              I read the checks
            </label>
          )}
          {primary?.action === "open_mail" && <MailButton d={d} onCopy={on.copySubject} variant="primary" />}
          {primary && primary.action !== "open_mail" && (
            <ActionButton
              aria-describedby={primary.reason ? `reason-${d.id}` : undefined}
              aria-disabled={!primary.enabled || primary.busy}
              className="aria-disabled:opacity-64 max-sm:h-(--control-l)"
              onClick={press}
              ref={primaryRef}
              size="m"
              variant="primary"
            >
              {(primary.action === "send" || primary.action === "confirm") && <SendIcon aria-hidden="true" />}
              {primary.busy ? "Sending" : primary.label}
            </ActionButton>
          )}
        </div>
      </div>
      {tickBlock && hasSwitch(state) && (
        <p className="text-end text-muted-foreground text-xs" id={`tick-${d.id}`}>
          {tickBlock}
        </p>
      )}
      {primary?.reason && !primaryMail && (
        <p className="text-end text-muted-foreground text-xs" id={`reason-${d.id}`}>
          {primary.reason}
        </p>
      )}
    </div>
  );
}
