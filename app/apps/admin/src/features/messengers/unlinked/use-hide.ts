import { toastManager } from "@hub/ui/toast";
import { actionToast } from "@hub/ui/product/action-toast";
import { sentence } from "@/lib/api/client";
import { useHideCommands } from "@/lib/data/messengers";

/**
 * Hide ("not a client", P84c) and Unhide of an unlinked chat. Hide is reversible, so it says so and offers the way back
 * (`ui-specifications.md` rule 5d): a toast with Undo, which is Unhide. The server keeps a keyed hash of the chat, never the chat;
 * the autolink never links a hidden chat. Both read the autolink's state again, so the row leaves or comes back at once.
 */
export function useHide(project: string) {
  const c = useHideCommands(project, {
    onError: (e) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" }),
    // P102: a hidden chat comes back to Not linked (and to To do while it is fresh); Undo hides it again.
    onUnhidden: (chat) => actionToast({ title: `${chat.title} is back in Not linked`, type: "success", action: { label: "Hide again", run: () => c.hide.mutate(chat) } }),
    onHidden: (chat) => actionToast({ title: `Hid ${chat.title}: not a client`, type: "success", action: { label: "Undo", run: () => c.unhide.mutate(chat) } }),
  });
  return c;
}
