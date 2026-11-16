import { useQueryClient } from "@tanstack/react-query";
import type { DraftMailDto } from "@hub/contract/responses";
import { tickBlock } from "./tick-guard";
import type { ReviewDraft } from "../source";
import type { ReviewActions } from "../use-review-actions";
import { draftMailKey } from "./use-draft-mail";

/**
 * `C`: Checked on or off from the keyboard. It asks the guard the switch asks (an unreadable draft, or one whose text has
 * no hash, is refused with the reason) and binds the tick to the hash of the read the card holds.
 */
export function useToggleChecked(project: string, actions: ReviewActions, say: (text: string) => void) {
  const qc = useQueryClient();
  return (d: ReviewDraft) => {
    const mail = qc.getQueryData<DraftMailDto>(draftMailKey(project, d.id));
    const why = tickBlock(d, mail);
    if (why) say(why);
    else actions.setChecked(d, !d.checked, d.checked ? null : (mail?.hash ?? null));
  };
}
