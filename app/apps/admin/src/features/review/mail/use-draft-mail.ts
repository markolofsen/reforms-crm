import { useQuery } from "@tanstack/react-query";
import { sendApi } from "@/lib/api/send";
import { isClosed, type ReviewDraft } from "../source";

/** One key factory for the read, so the card and the `C` key see the same answer (`state-and-data.md` rule 2). */
export const draftMailKey = (project: string, id: number) => ["draft-mail", project, id] as const;

/**
 * The draft as Mail holds it right now (P27 M2): read on demand when the card is open, never stored. A batch draft
 * (written into the hub, no Mail draft of its own) and a closed one are not read. Re-read when the window regains focus, so a
 * text edited in Mail shows up before Checked or Send, and the answer carries the hash Checked binds to.
 */
export function useDraftMail(project: string, d: ReviewDraft) {
  const enabled = d.batchId === null && !isClosed(d) && d.status === "ready";
  return useQuery({
    queryKey: draftMailKey(project, d.id),
    queryFn: () => sendApi.mail(project, d.id),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
