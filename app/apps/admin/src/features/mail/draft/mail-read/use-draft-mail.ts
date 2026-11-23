import { useQuery } from "@tanstack/react-query";
import { sendApi } from "@/lib/api/send";
import { isClosed, type ReviewDraft } from "@/features/mail/model";
import { keys } from "@/lib/cache/keys";

/** One key factory for the read, so the card and the `C` key see the same answer (`state-and-data.md` rule 2). */

/**
 * The draft as Mail holds it right now (P27 M2): read on demand when the card is open, never stored. A closed draft is
 * not read (P85: a batch draft is a Mail draft like any other, so it is read). Re-read when the window regains focus, so a
 * text edited in Mail shows up before Checked or Send, and the answer carries the hash Checked binds to.
 */
export function useDraftMail(project: string, d: ReviewDraft) {
  const enabled = !isClosed(d) && d.status === "ready";
  return useQuery({
    queryKey: keys.draftMail(project, d.id),
    queryFn: () => sendApi.mail(project, d.id),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
