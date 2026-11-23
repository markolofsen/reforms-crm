import { tickBlock } from "./tick-guard";
import type { ReviewDraft } from "@/features/mail/model";
import type { ReviewActions } from "@/features/mail/list/use-review-actions";
import { useDraftMailOf } from "@/lib/data/drafts";

/**
 * `C`: Checked (for Send all Checked of a batch) from the keyboard. Off is at once; on opens the review dialog in its Check mode
 * (P105), where the checks are read and accepted once. An unreadable draft, or one with nothing to check, is refused with the reason.
 */
export function useToggleChecked(project: string, actions: ReviewActions, say: (text: string) => void) {
  const mailOf = useDraftMailOf(project);
  return (d: ReviewDraft) => {
    const mail = mailOf(d.id);
    if (d.checked) return actions.setChecked(d, false);
    const why = tickBlock(d, mail);
    if (why) say(why);
    else actions.openReview(d, "check");
  };
}
