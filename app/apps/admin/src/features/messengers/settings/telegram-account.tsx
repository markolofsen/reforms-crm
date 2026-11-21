import { Skeleton } from "@hub/ui/skeleton";
import { LoadFailed } from "@/components/state-views";
import { telegramUserApi } from "@/lib/api/messengers/telegram-user";
import { keys } from "@/lib/cache/keys";
import { AccountRow } from "./account-row";
import { ConnectForm } from "./connect-form";
import { useTelegramUser } from "./use-telegram";

/**
 * Messengers ▸ Settings, Telegram account (P71 M3): the connected account with its state and Disconnect, or the connect form with
 * its risk sentence. When the server keeps Telegram accounts off (`HUB_MESSENGERS=off`, several projects) its reason is the one
 * line above the form; the form still drives the routes, and the server's refusal lands in the form's alert.
 */
export function TelegramAccount({ linked }: { linked?: number }) {
  const q = useTelegramUser();
  if (q.isPending) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the Telegram account" />;
  const d = q.data;
  if (d.accounts.length > 0)
    return (
      <ul aria-label="Telegram accounts" className="flex flex-col divide-y border-y">
        {d.accounts.map((a) => (
          <AccountRow
            a={a}
            channel="telegram_user"
            linked={linked}
            disconnect={telegramUserApi.disconnect}
            key={a.account}
            label={`Telegram account ${a.account}`}
            note="The session file is deleted; the linked chats and their messages stay. To read them again, connect the account again."
            statusKey={keys.telegramUser()}
          />
        ))}
      </ul>
    );
  return (
    <div className="flex flex-col gap-2">
      {d.state === "off" && d.reason && <p className="text-muted-foreground text-sm">Telegram accounts are off on this server: {d.reason}.</p>}
      <ConnectForm />
    </div>
  );
}
