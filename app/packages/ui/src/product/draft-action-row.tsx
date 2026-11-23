import { SendIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { ActionButton, type ActionSize } from "./action-button";

/**
 * The one action row of an unsent message (P105, P127 C3), the same in Mail's draft card, a messenger draft and Mail's reply
 * without a draft: frequent and reversible actions at the start, the ONE primary at the end (Send, or what the state proposes),
 * an optional line above them (queued until, why Send waits). Send never sends from here: it opens the review dialog.
 */
export function DraftActionRow({ start, primary, note, ariaLabel = "Actions", testId }: { start?: ReactNode; primary?: ReactNode; note?: ReactNode; ariaLabel?: string; testId?: string }) {
  return (
    <div aria-label={ariaLabel} className="flex min-w-0 flex-col gap-2" data-testid={testId} role="group">
      {note}
      <div className="flex flex-wrap items-center gap-2">
        {start}
        {primary && <div className="ms-auto flex items-center gap-2">{primary}</div>}
      </div>
    </div>
  );
}

/** Send of an unsent message: it opens the review dialog (the dialog's own button sends). `who` names the person for a screen reader. */
export function DraftSendButton({ onClick, who, busy = false, disabled = false, size = "m", ref }: { onClick: () => void; who: string; busy?: boolean; disabled?: boolean; size?: ActionSize; ref?: Ref<HTMLButtonElement> }) {
  return (
    <ActionButton data-testid="draft-send" disabled={disabled} loading={busy} onClick={onClick} ref={ref} size={size} variant="primary">
      <SendIcon aria-hidden="true" />
      Send
      <span className="sr-only"> the reply to {who}</span>
    </ActionButton>
  );
}
