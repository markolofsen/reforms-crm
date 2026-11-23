import type { AutolinkLinkedDto } from "@hub/contract/messengers";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { useChatMoveCommands } from "@/lib/data/messengers";
import { linkedLine, movedLine } from "../labels";

/**
 * P102: the moves of a chat between its states, one hook for every row and for the Link a chat box. Each move that can be taken
 * back says so in its toast with Undo (`ui-specifications.md` rule 5d): Link (Undo unlinks it again), Change client (Undo moves it
 * back and brings back the draft that was set aside), Unhide (Undo hides it again); Unlink deletes, so it asks first on the row and
 * has no Undo. After a move the panel and the autolink's memory are read again (the commands of `lib/data/messengers.ts`, topic `messengers`).
 */
export function useChatMoves(project: string) {
  const fail = (e: unknown) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" });
  /** The toast after a link or a Create and link: what was loaded, what was written to Notion, and the way back. */
  const announce = (res: AutolinkLinkedDto, c: { channel: "telegram_user" | "whatsapp"; chatId: string }) => {
    toastManager.add({
      title: linkedLine(res),
      ...(res.notion ? { description: res.notion } : {}),
      type: res.importError ? "warning" : "success",
      actionProps: { children: "Unlink again", onClick: () => void m.unlinkAgain(c).catch(fail) },
    });
    return m.refresh();
  };
  const m = useChatMoveCommands(project, {
    onError: fail,
    onUnlinked: (v) => toastManager.add({ title: v.never ? `Unlinked ${v.name} and hid it: not a client` : `Unlinked ${v.name}`, type: "success" }),
    onLinked: (res, v) => void announce(res, v),
    onChanged: (r, v) => {
      const draft = r.skippedDraftId !== null ? ` The draft for ${r.fromName} was skipped; Undo brings it back.` : "";
      toastManager.add({
        title: movedLine({ name: v.name, to: r.toName }),
        description: `Its messages stayed with the chat.${draft}${r.notion ? ` ${r.notion}.` : ""}`,
        type: "success",
        actionProps: { children: "Undo", onClick: () => m.undoChange.mutate({ id: v.id, clientId: r.fromClientId, draftId: r.skippedDraftId }) },
      });
    },
  });
  const { link, change, unlink } = m;
  return { link, change, unlink, announce, pending: link.isPending || change.isPending || unlink.isPending };
}
