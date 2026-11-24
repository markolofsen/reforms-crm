import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { useChatDone } from "@/lib/data/messengers";
import { doneToast } from "../labels";

/**
 * P143 D2: No reply needed on a chat, from the conversation header, the row's menu and the D key: the chat leaves Needs you until
 * their next message reopens it, with Undo on the toast (`ui-specifications.md` rule 5d). Mail's No reply needed is the same rule.
 */
export function useDoneChat(project: string) {
  const { done, undo } = useChatDone(project, {
    onDone: (v) =>
      toastManager.add({
        title: doneToast(v.name),
        type: "success",
        actionProps: { children: "Undo", onClick: () => undo.mutate(v.id) },
      }),
    onError: (e) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" }),
  });
  // Reopen: a chat the agent (or he, earlier) closed goes back to Needs you; the same Undo route.
  return { mark: (id: number, name: string) => done.mutate({ id, name }), reopen: (id: number) => undo.mutate(id), pending: done.isPending || undo.isPending };
}
