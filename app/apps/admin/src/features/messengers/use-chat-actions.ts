import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { messengerMutationKeys } from "@/lib/cache/keys";

/**
 * The owner's moves on a messenger draft (P71 M3): Edit (his own words, saved to the row while it waits), Skip (set aside, with a
 * toast and Undo, `ui-specifications.md` rule 5d) and the Undo. One settle rule, as on Drafts: on success the panel is read
 * again; on failure the server's sentence is shown and the panel is read again, since a 409 means it was stale. Send is not
 * here: it is the send door's (`use-messenger-send.ts`, P71 M4).
 */
export function useChatActions(project: string, activeChatId: number | null = null) {
  const qc = useQueryClient();
  // A failure belongs to the chat it happened on: opening another chat shows none (stored with its chat, no reset effect).
  const [failure, setFailure] = useState<{ chat: number | null; message: string } | null>(null);
  const error = failure !== null && failure.chat === activeChatId ? failure.message : null;
  const refresh = () => Promise.all(messengerMutationKeys(project, activeChatId).map((queryKey) => qc.invalidateQueries({ queryKey })));
  const settle = {
    onSuccess: () => {
      setFailure(null);
      return refresh();
    },
    onError: (e: unknown) => {
      setFailure({ chat: activeChatId, message: sentence(e) });
      return refresh();
    },
  };
  const edit = useMutation({ mutationFn: ({ id, text }: { id: number; text: string }) => messengersApi.editDraft(project, id, text), ...settle });
  const restore = useMutation({ mutationFn: (id: number) => messengersApi.restoreDraft(project, id), ...settle });
  const skip = useMutation({
    mutationFn: ({ id }: { id: number; name: string }) => messengersApi.skipDraft(project, id),
    ...settle,
    onSuccess: (_r, v) => {
      toastManager.add({ title: `Skipped the draft for ${v.name}`, type: "success", actionProps: { children: "Undo", onClick: () => restore.mutate(v.id) } });
      return settle.onSuccess();
    },
  });
  const pending = edit.isPending || skip.isPending || restore.isPending;
  return { edit, skip, restore, pending, error, clearError: () => setFailure(null) };
}
