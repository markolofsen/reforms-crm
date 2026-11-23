import { useQueryClient } from "@tanstack/react-query";
import type { MessengerSendPreviewDto } from "@hub/contract/messenger";
import type { MessengerDraftDto } from "@hub/contract/messenger-panel";
import { toastManager } from "@hub/ui/toast";
import { useSendDoor } from "@/components/send/send-flow";
import { messengerSendApi } from "@/lib/api/messengers/send";
import { keys, messengerMutationKeys } from "@/lib/cache/keys";
import { ChannelIcon } from "./channel/channel-icon";
import { CHANNEL_LABEL } from "./labels";

/**
 * Send of one messenger draft (P71 M4) through the one door Mail's card uses (`components/send/send-flow.ts`): the dry run, then
 * the apply with the chat and the exact text the owner read. Afterwards the panel and Activity ▸ Sends are read again.
 */
export function useMessengerSend(project: string, d: MessengerDraftDto, chatId: number) {
  const qc = useQueryClient();
  return useSendDoor<MessengerSendPreviewDto>({
    preview: () => messengerSendApi.preview(project, d.id),
    send: (p) => messengerSendApi.send(project, d.id, { chatId: p.chatId, text: p.text }),
    sent: (p) =>
      toastManager.add({
        title: (
          <span className="flex items-center gap-2">
            <ChannelIcon channel={p.channel} decorative />
            Sent to {p.to} on {CHANNEL_LABEL[p.channel]}
          </span>
        ),
        type: "success",
      }),
    settle: () => Promise.all([...messengerMutationKeys(project, chatId).map((queryKey) => qc.invalidateQueries({ queryKey })), qc.invalidateQueries({ queryKey: keys.sends(project) })]),
  });
}
