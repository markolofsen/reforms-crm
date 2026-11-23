import type { MessengerSendPreviewDto } from "@hub/contract/messenger";
import type { MessengerDraftDto } from "@hub/contract/messenger-panel";
import { toastManager } from "@hub/ui/toast";
import { useMessengerSendFlow } from "@/lib/data/messengers";
import { ChannelIcon } from "./channel/channel-icon";
import { CHANNEL_LABEL } from "./labels";

/**
 * Send of one messenger draft (P71 M4, decision 0046) through the one door Mail's card uses (`useMessengerSendFlow` of
 * `lib/data/messengers.ts`): the dry run, then the apply with the chat and the exact text the owner read; this hook says the toast.
 */
export function useMessengerSend(project: string, d: MessengerDraftDto) {
  return useMessengerSendFlow(project, d.id, (p: MessengerSendPreviewDto) => {
    toastManager.add({
      title: (
        <span className="flex items-center gap-2">
          <ChannelIcon channel={p.channel} decorative />
          Sent to {p.to} on {CHANNEL_LABEL[p.channel]}
        </span>
      ),
      type: "success",
    });
  });
}
