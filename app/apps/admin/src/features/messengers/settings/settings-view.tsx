import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { MESSENGER_DAILY_CAP, MESSENGER_SPACING_SECONDS } from "@hub/config/chat-rules";
import { Page } from "@hub/ui/product/page";
import { LoadFailed, Loading } from "@/components/state-views";
import { AppLink } from "@/components/app-link";
import { LocalActionButton } from "@/components/local-action";
import { messengersApi } from "@/lib/api/messengers/panel";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { dest } from "@/routes/paths";
import { ConnectionsView } from "../../settings/connections/connections-view";
import { SettingsGroup as Group } from "../../settings/group";
import { ChatRules } from "./chat-rules";
import { TelegramAccount } from "./telegram-account";
import { WhatsAppAccount } from "./whatsapp/whatsapp-account";

/** The send guards of a user account (decision 0036 point 7), read only: the send door applies them to Telegram and WhatsApp. */
export const GUARDS: readonly string[] = [
  "Only a chat where the client wrote first: the Hub never makes first contact.",
  `At most ${MESSENGER_DAILY_CAP} sends a day per account.`,
  `At least ${MESSENGER_SPACING_SECONDS} seconds between two sends on one account.`,
  "Stop sending (Settings ▸ Sending) stops every channel.",
];

/** The linked chats with their rules. Linking, changing the client and unlinking are on Chats (P102): one place, the row's state menu. */
type LinkedChatsData = Awaited<ReturnType<typeof messengersApi.chats>>;
type LinkedChatsQuery = UseQueryResult<LinkedChatsData, unknown>;

function LinkedChats({ project, query }: { project: string; query: LinkedChatsQuery }) {
  const q = query;
  return (
    <div className="flex flex-col gap-4">
      {q.isPending ? <Loading what="chats" /> : !q.data ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the linked chats" />
      ) : q.data.chats.length === 0 ? (
        <div className="flex flex-col gap-1 text-sm">
          <p>No linked chats yet. <AppLink to={dest("messengers.page")}>Link a chat from Chats.</AppLink></p>
          <p className="text-muted-foreground text-xs">Unlinked chats are not stored.</p>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            Change the client, unlink or hide a chat from its status menu on <AppLink to={dest("messengers.page")}>Messengers ▸ Chats</AppLink>.
          </p>
          <ul aria-label="Linked chats" className="flex flex-col divide-y border-y">
            {q.data.chats.map((c) => (
              <ChatRules c={c} key={c.id} preanalysis={q.data.preanalysis} project={project} />
            ))}
          </ul>
        </>
      )}
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
  const chats = useQuery({ queryKey: keys.messengerChats(project, "linked"), queryFn: () => messengersApi.chats(project, { filter: "linked" }) });
  const overview = useQuery({ queryKey: keys.project(project), queryFn: () => metaApi.overview(project) });
  const policy = overview.data?.messengerPolicy;
  const languageLine = `Language follows the client by default${policy?.language ? ` · project: ${policy.language}` : ""}`;
  const policyUnavailable = overview.isError ? "Project policy could not be loaded." : null;
  const policyLoading = overview.isPending ? "Loading project policy…" : null;
  const linkedOf = (ch: "telegram_user" | "whatsapp") => chats.data?.chats.filter((c) => c.channel === ch).length;
  return (
    <Page>
      <div className="flex flex-col gap-4">
        <Group id="reply-policy" title="Reply policy">
          <div className="measure flex flex-col gap-2 text-sm">
            <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted-foreground">Language</dt>
              <dd>{policyLoading ?? policyUnavailable ?? languageLine}</dd>
            </dl>
            {policy?.instruction && <p className="text-muted-foreground text-xs">A project instruction is active; chat-specific overrides are listed below.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <LocalActionButton action="file.open" args={{ project, key: "project.md" }} size="s" variant="secondary">Open project policy</LocalActionButton>
              <span className="text-muted-foreground text-xs">Set messengers.language and messengers.instruction there.</span>
            </div>
          </div>
        </Group>
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
        <Group id="guards" title="Send guards">
          <ul className="measure flex list-disc flex-col gap-1 ps-5 text-sm">
            {GUARDS.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">They apply to every Send, on Telegram and on WhatsApp.</p>
        </Group>
      </div>
    </Page>
  );
}
