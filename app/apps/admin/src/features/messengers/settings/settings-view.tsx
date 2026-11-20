import { useQuery } from "@tanstack/react-query";
import { MESSENGER_DAILY_CAP, MESSENGER_SPACING_SECONDS } from "@hub/config/chat-rules";
import { Page } from "@hub/ui/product/page";
import { LoadFailed } from "@/components/state-views";
import { SubNav } from "@/components/sub-nav";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";
import { ConnectionsView } from "../../settings/connections/connections-view";
import { SettingsGroup as Group } from "../../settings/group";
import { ChatRules } from "./chat-rules";
import { LinkPicker } from "./link-picker";
import { TelegramAccount } from "./telegram-account";
import { useTelegramUser } from "./use-telegram";

/** The send guards of a user account (decision 0036 point 7), read only: the send door applies them from P71 M4. */
export const GUARDS: readonly string[] = [
  "Only a chat where the client wrote first: the Hub never makes first contact.",
  `At most ${MESSENGER_DAILY_CAP} sends a day per account.`,
  `At least ${MESSENGER_SPACING_SECONDS} seconds between two sends on one account.`,
  "Stop sending (Settings ▸ Sending) stops every channel.",
];

/** The linked chats with their rules, then the picker that links another. */
function LinkedChats({ project, account }: { project: string; account: string | null }) {
  const q = useQuery({ queryKey: keys.messengerChats(project, "all"), queryFn: () => messengersApi.chats(project, "all") });
  return (
    <div className="flex flex-col gap-4">
      {q.isPending ? null : !q.data ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the linked chats" />
      ) : q.data.chats.length === 0 ? (
        <p className="text-muted-foreground text-sm">No chat is linked yet. Nothing of an unlinked chat is stored, not even a count.</p>
      ) : (
        <ul aria-label="Linked chats" className="flex flex-col divide-y border-y">
          {q.data.chats.map((c) => (
            <ChatRules c={c} key={c.id} project={project} />
          ))}
        </ul>
      )}
      <LinkPicker account={account} project={project} />
    </div>
  );
}

/**
 * Messengers ▸ Settings (P71 M3, decision 0036 point 6): what is set rarely for the messengers, every group in view (nothing
 * folded, as Settings since P75). The owner's Telegram account (connect with the risk sentence, its state, Disconnect), WhatsApp
 * (M5), the Telegram bot's token, the linked chats with their rules and "Link a chat", and the send guards' numbers.
 */
export function MessengerSettings({ project }: { project: string }) {
  const tg = useTelegramUser();
  const account = tg.data?.accounts.find((a) => a.state === "running")?.account ?? null;
  return (
    <Page nav={<SubNav section="messengers" />}>
      <div className="flex flex-col gap-8">
        <Group id="telegram-account" title="Telegram account">
          <TelegramAccount />
        </Group>
        <Group id="whatsapp" title="WhatsApp">
          <p className="text-muted-foreground text-sm">WhatsApp as a linked device comes in P71 M5: a QR code to scan here, then the same linked chats and guards.</p>
        </Group>
        {/* No heading: the row's own label says "Telegram bot" (a heading over it said it twice, `admin-principles.md` rule 9). */}
        <ConnectionsView kinds={["telegram"]} label="Telegram bot" />
        <Group id="linked-chats" title="Linked chats">
          <LinkedChats account={account} project={project} />
        </Group>
        <Group id="guards" title="Send guards">
          <ul className="measure flex list-disc flex-col gap-1 ps-5 text-sm">
            {GUARDS.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">They apply when Send comes, with the send door (P71 M4).</p>
        </Group>
      </div>
    </Page>
  );
}
