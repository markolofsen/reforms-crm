import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";

type Chat = { channel: "telegram_user" | "whatsapp"; chatId: string; title: string };

/**
 * Hide ("not a client", P84c) and Unhide of an unlinked chat. Hide is reversible, so it says so and offers the way back
 * (`ui-specifications.md` rule 5d): a toast with Undo, which is Unhide. The server keeps a keyed hash of the chat, never the chat;
 * the autolink never links a hidden chat. Both read the autolink's state again, so the row leaves or comes back at once.
 */
export function useHide(project: string) {
  const qc = useQueryClient();
  const settle = () => qc.invalidateQueries({ queryKey: keys.autolink(project) });
  const fail = (e: unknown) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" });
  const unhide = useMutation({
    mutationFn: (c: Chat) => messengersApi.unhideChat(project, { channel: c.channel, chatId: c.chatId }),
    onSuccess: (_r, c) => {
      toastManager.add({ title: `${c.title} is back on To do`, type: "success" });
      return settle();
    },
    onError: fail,
  });
  const hide = useMutation({
    mutationFn: (c: Chat) => messengersApi.hideChat(project, { channel: c.channel, chatId: c.chatId }),
    onSuccess: (_r, c) => {
      toastManager.add({ title: `Hid ${c.title}: not a client`, type: "success", actionProps: { children: "Undo", onClick: () => unhide.mutate(c) } });
      return settle();
    },
    onError: fail,
  });
  return { hide, unhide };
}
