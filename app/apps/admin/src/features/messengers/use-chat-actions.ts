import { useState } from "react";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { useMessengerDraftCommands } from "@/lib/data/messengers";

/**
 * The owner's moves on a messenger draft (P71 M3): Edit (his own words, saved to the row while it waits), Skip (set aside, with a
 * toast and Undo, `ui-specifications.md` rule 5d) and the Undo. One settle rule, as on Drafts: the commands of `lib/data/messengers.ts`
 * read the panel again on success and on failure (a 409 means it was stale); a failure's sentence is shown. `undoSkip` is the U key's. Send is not here: it is
 * the send door's (`use-messenger-send.tsx`, P71 M4).
 */
export function useChatActions(project: string, activeChatId: number | null = null) {
  // A failure belongs to the chat it happened on: opening another chat shows none (stored with its chat, no reset effect).
  const [failure, setFailure] = useState<{ chat: number | null; message: string } | null>(null);
  const error = failure !== null && failure.chat === activeChatId ? failure.message : null;
  // The last Skip, for the U key (P127 C2 question 1): the toast's Undo and U put back the same draft.
  const [lastSkipped, setLastSkipped] = useState<{ id: number; name: string } | null>(null);
  const { edit, restore, skip } = useMessengerDraftCommands(project, {
    onSuccess: () => setFailure(null),
    onError: (e) => setFailure({ chat: activeChatId, message: sentence(e) }),
    onSkipped: (v) => {
      setLastSkipped(v);
      toastManager.add({ title: `Skipped the draft for ${v.name}`, type: "success", actionProps: { children: "Undo", onClick: () => restore.mutate(v.id) } });
    },
  });
  const pending = edit.isPending || skip.isPending || restore.isPending;
  const undoSkip = lastSkipped
    ? () => {
        restore.mutate(lastSkipped.id);
        setLastSkipped(null);
      }
    : null;
  return { edit, skip, restore, undoSkip, pending, error, clearError: () => setFailure(null) };
}
