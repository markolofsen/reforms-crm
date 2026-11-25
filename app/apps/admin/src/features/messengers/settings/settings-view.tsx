import { MESSENGER_DAILY_CAP, MESSENGER_SPACING_SECONDS } from "@hub/config/chat-rules";
import { Page } from "@hub/ui/product/shell/page";
import { Loading, QueryView } from "@/components/state-views";
import { AppLink } from "@/components/app-link";
import type { ViewQuery } from "@/components/state-views";
import { useMessengerChats } from "@/lib/data/messengers";
import { dest } from "@/routes/paths";
import { ConnectionsView } from "../../settings/connections/connections-view";
import { SettingsGroup as Group } from "../../settings/group";
import { ChatRules } from "./chat-rules";
import { TelegramAccount } from "./telegram-account";
import { WhatsAppAccount } from "./whatsapp/whatsapp-account";
import { AutopilotSettings } from "../autopilot/settings";

/** The send guards of a user account (decision 0036 point 7), read only: the send door applies them to Telegram and WhatsApp. */
export const GUARDS: readonly string[] = [
  "Only a chat where the client wrote first: the Hub never makes first contact.",
  `At most ${MESSENGER_DAILY_CAP} sends a day per account.`,
  `At least ${MESSENGER_SPACING_SECONDS} seconds between two sends on one account.`,
  "Stop sending (Settings ▸ Sending) stops every channel.",
];

/** The linked chats with their rules. Linking, changing the client and unlinking are on Chats (P102): one place, the row's state menu. */
type LinkedChatsQuery = ViewQuery<NonNullable<ReturnType<typeof useMessengerChats>["data"]>>;

function LinkedChats({ project, query }: { project: string; query: LinkedChatsQuery }) {
  const q = query;
  return (
    <div className="flex flex-col gap-4">
      <QueryView loading={<Loading what="chats" />} query={q} what="the linked chats">
        {(d) =>
          d.chats.length === 0 ? (
        <div className="flex flex-col gap-1 text-sm">
          <p>No linked chats yet. <AppLink to={dest("messengers.page")}>Link a chat from Chats.</AppLink></p>
          <p className="text-muted-foreground text-xs">An unlinked chat still opens on Chats; its messages are kept as a 30-day cache.</p>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            Change the client, unlink or hide a chat from its status menu on <AppLink to={dest("messengers.page")}>Messengers ▸ Chats</AppLink>.
          </p>
          {/* P128 X5: the OpenRouter notice once, with where the key is set, instead of on every chat. */}
          {d.preanalysis.state === "no_key" && <p className="measure text-muted-foreground text-xs" role="note">Pre-analysis is off on every chat until the Hub has an OpenRouter key.{d.preanalysis.fix ? ` ${d.preanalysis.fix}` : " Set it in Settings ▸ Connections."}</p>}
          <ul aria-label="Linked chats" className="flex flex-col divide-y border-y">
            {d.chats.map((c) => (
              <ChatRules c={c} key={c.id} preanalysis={d.preanalysis} project={project} />
            ))}
          </ul>
        </>
          )
        }
      </QueryView>
    </div>
  );
}

/**
 * Settings ▸ Messengers (P71 M3, decision 0036 point 6): what is set rarely for the messengers, every group in view (nothing
 * folded, as Settings since P75). The owner's Telegram account (connect with the risk sentence, its state, Disconnect), his WhatsApp
 * number (P71 M5: Connect, the QR code to scan, its state, Disconnect), the Telegram bot's token, the linked chats with their rules
 * (linking is on Chats, P102), and the send guards' numbers.
 */
export function MessengerSettings({ project }: { project: string }) {
  // P84: the account rows say how many chats the Hub reads (the linked ones), from the same list as Linked chats below.
  const chats = useMessengerChats(project, { filter: "all", link: "linked", channel: "all", q: "" });
  const linkedOf = (ch: "telegram_user" | "whatsapp") => chats.data?.chats.filter((c) => c.channel === ch).length;
  return (
    <Page>
      <div className="flex flex-col gap-4">
        <Group id="telegram-account" title="Telegram account">
          <TelegramAccount linked={linkedOf("telegram_user")} />
        </Group>
        <Group id="whatsapp" title="WhatsApp">
          <WhatsAppAccount linked={linkedOf("whatsapp")} />
        </Group>
        {/* No heading: the row's own label says "Telegram bot" (a heading over it said it twice, `admin-principles.md` rule 9). */}
        <ConnectionsView kinds={["telegram"]} label="Telegram bot" />
        <Group id="linked-chats" title="Linked chats">
          <LinkedChats project={project} query={chats} />
        </Group>
        <Group id="autopilot" title="Autopilot">
          <AutopilotSettings project={project} />
        </Group>
        <Group id="guards" title="Send guards">
          <ul className="measure flex list-disc flex-col gap-1 ps-5 text-sm">
            {GUARDS.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">They apply to every send on Telegram and WhatsApp: your Send, the agent&apos;s send on your word and the autopilot go through the same door.</p>
        </Group>
      </div>
    </Page>
  );
}
