import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DraftMailDto } from "@hub/contract/mail";
import { refreshData } from "@/lib/api/client";
import { sendApi } from "@/lib/api/send";
import { keys } from "@/lib/cache/keys";

/**
 * The two writes a person makes to a draft's Mail text (P56): Save (the edited text, over the read whose hash it carries)
 * and Restore (the Hub's last copy, back from Trash). Both go through the server's one writer, which turns Checked off.
 * On success the card shows the saved text at once, with no hash (so it cannot be Checked until Mail is read back), and
 * Mail is read again; the row and the list refresh with it.
 */
export function useMailWrite(project: string, draftId: number) {
  const qc = useQueryClient();
  const key = keys.draftMail(project, draftId);
  const settle = () => refreshData(qc, { mail: true });
  const save = useMutation({
    mutationFn: (v: { text: string; hash: string }) => sendApi.save(project, draftId, v.text, v.hash),
    onSuccess: (_r, v) => {
      qc.setQueryData<DraftMailDto>(key, (old) => (old ? { ...old, body: v.text, hash: null, note: "Saved to Mail. Reading it back before it can be checked.", checkedCurrent: false } : old));
      return settle();
    },
  });
  const restore = useMutation({ mutationFn: () => sendApi.restore(project, draftId), onSuccess: settle });
  return { save, restore };
}
