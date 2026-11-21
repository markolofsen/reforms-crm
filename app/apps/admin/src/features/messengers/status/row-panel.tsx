import type { ReactNode } from "react";
import { ActionButton } from "@hub/ui/product/action-button";

/**
 * The in-place confirmation of a move that deletes (`ui-specifications.md` rule 5d, P102): the sentence says what goes and what
 * linking again brings back, the danger button names the act, Cancel keeps everything. It sits under its own row, so the owner
 * reads it where he pressed.
 */
export function Confirm({ sentence, act, pending, onConfirm, onCancel }: { sentence: string; act: string; pending: boolean; onConfirm: () => void; onCancel: () => void }): ReactNode {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Confirm">
      <p className="measure text-sm">{sentence}</p>
      <div className="flex flex-wrap gap-2">
        <ActionButton disabled={pending} onClick={onConfirm} size="s" variant="danger">
          {act}
        </ActionButton>
        <ActionButton disabled={pending} onClick={onCancel} size="s" variant="quiet">
          Cancel
        </ActionButton>
      </div>
    </div>
  );
}
