import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";

const chatsOf = keys.messengerChatsOf;

/**
 * The owner's moves on a messenger draft (P71 M3): Edit (his own words, saved to the row while it waits), Skip (set aside, with a
 * toast and Undo, `ui-specifications.md` rule 5d) and the Undo. One settle rule, as on Drafts: on success the panel is read
 * again; on failure the server's sentence is shown and the panel is read again, since a 409 means it was stale. Send is not
 * here: it is the send door's (`use-messenger-send.ts`, P71 M4).
 */
export function useChatActions(project: string) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const settle = {
    onSuccess: () => {
      setError(null);
      return qc.invalidateQueries({ queryKey: chatsOf(project) });
    },
    onError: (e: unknown) => {
      setError(sentence(e));
      return qc.invalidateQueries({ queryKey: chatsOf(project) });
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
  return { edit, skip, restore, pending, error };
}
