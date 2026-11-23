import { isClosed, type ReviewDraft } from "@/features/mail/model";
import { useDraftMail as useDraftMailRead } from "@/lib/data/drafts";

/**
 * The draft as Mail holds it right now (P27 M2; the read is `lib/data/drafts.ts`'s, one key, so the card and the `C` key see the
 * same answer). A closed draft is not read (P85: a batch draft is a Mail draft like any other, so it is read).
 */
export function useDraftMail(project: string, d: ReviewDraft) {
  return useDraftMailRead(project, d.id, !isClosed(d) && d.status === "ready");
}
