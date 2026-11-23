import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AutolinkLinkedDto, AutolinkRecordDto } from "@hub/contract/messengers";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys, messengerMutationKeys } from "@/lib/cache/keys";
import { linkedLine, movedLine } from "../labels";

type UserChannel = "telegram_user" | "whatsapp";
type Linkable = { channel: UserChannel; account: string; chatId: string; title: string };

/**
 * P102: the moves of a chat between its states, one hook for every row and for the Link a chat box. Each move that can be taken
 * back says so in its toast with Undo (`ui-specifications.md` rule 5d): Link (Undo unlinks it again), Change client (Undo moves it
 * back and brings back the draft that was set aside), Unhide (Undo hides it again); Unlink deletes, so it asks first on the row and
 * has no Undo. After a move both the panel and the autolink's memory are read again.
 */
export function useChatMoves(project: string, activeChatId: number | null = null) {
  const qc = useQueryClient();
  const settle = (chatId: number | null = activeChatId) => Promise.all([
    ...messengerMutationKeys(project, chatId).map((queryKey) => qc.invalidateQueries({ queryKey })),
    qc.invalidateQueries({ queryKey: keys.autolink(project) }),
  ]);
  const fail = (e: unknown) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" });

  const unlink = useMutation({
    mutationFn: ({ id, never }: { id: number; never: boolean; name: string }) => messengersApi.unlinkChat(project, id, never),
    onSuccess: (_r, v) => {
      toastManager.add({ title: v.never ? `Unlinked ${v.name} and hid it: not a client` : `Unlinked ${v.name}`, type: "success" });
      return settle(v.id);
    },
    onError: fail,
  });

  // Undo of Link: the chat's row id is only known once it is linked, so the panel is read for it.
  const unlinkAgain = async (c: Pick<Linkable, "channel" | "chatId">) => {
    const linked = await messengersApi.chats(project, { filter: "linked" });
    const row = linked.chats.find((x) => x.chatId === c.chatId && (x.channel === c.channel));
    if (row) await messengersApi.unlinkChat(project, row.id, false);
    await settle(row?.id ?? null);
  };
  /** The toast after a link or a Create and link: what was loaded, what was written to Notion, and the way back. */
  const announce = (res: AutolinkLinkedDto, c: Pick<Linkable, "channel" | "chatId">) => {
    toastManager.add({
      title: linkedLine(res),
      ...(res.notion ? { description: res.notion } : {}),
      type: res.importError ? "warning" : "success",
      actionProps: { children: "Unlink again", onClick: () => void unlinkAgain(c).catch(fail) },
    });
    return settle(null);
  };
  const link = useMutation({
    mutationFn: ({ rec, ...c }: Linkable & { rec: Pick<AutolinkRecordDto, "key"> }) => messengersApi.linkRecord(project, { channel: c.channel, account: c.account, chatId: c.chatId, key: rec.key, title: c.title }),
    onSuccess: (res: AutolinkLinkedDto, v) => announce(res, v),
    onError: fail,
  });

  const undoChange = useMutation({
    mutationFn: ({ id, clientId, draftId }: { id: number; clientId: number; draftId: number | null }) => messengersApi.undoChange(project, id, { clientId, draftId }),
    onSuccess: (_r, v) => settle(v.id),
    onError: fail,
  });
  const change = useMutation({
    mutationFn: ({ id, key }: { id: number; key: string; name: string }) => messengersApi.changeClient(project, id, key),
    onSuccess: (r, v) => {
      const draft = r.skippedDraftId !== null ? ` The draft for ${r.fromName} was skipped; Undo brings it back.` : "";
      toastManager.add({
        title: movedLine({ name: v.name, to: r.toName }),
        description: `Its messages stayed with the chat.${draft}${r.notion ? ` ${r.notion}.` : ""}`,
        type: "success",
        actionProps: { children: "Undo", onClick: () => undoChange.mutate({ id: v.id, clientId: r.fromClientId, draftId: r.skippedDraftId }) },
      });
      return settle(v.id);
    },
    onError: fail,
  });
  return { link, change, unlink, announce, pending: link.isPending || change.isPending || unlink.isPending };
}
