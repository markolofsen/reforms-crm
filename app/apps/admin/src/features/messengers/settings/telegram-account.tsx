import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { TelegramUserAccountDto } from "@hub/contract/messengers";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { LoadFailed } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { telegramUserApi } from "@/lib/api/messengers/telegram-user";
import { keys } from "@/lib/cache/keys";
import { ConnectForm } from "./connect-form";
import { useTelegramUser } from "./use-telegram";

const STATE_WORD: Record<TelegramUserAccountDto["state"], { word: string; badge: "success" | "warning" | "error" | "outline" }> = {
  running: { word: "Connected", badge: "success" },
  starting: { word: "Connecting", badge: "outline" },
  error: { word: "Failing, retries", badge: "warning" },
  parked: { word: "Parked", badge: "error" },
  stopped: { word: "Stopped", badge: "outline" },
};

/** One connected account: its id, its state, the fix line of a park, and Disconnect, confirmed in place (it removes the session). */
function AccountRow({ a }: { a: TelegramUserAccountDto }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const off = useMutation({ mutationFn: () => telegramUserApi.disconnect(a.account), onSettled: () => qc.invalidateQueries({ queryKey: keys.telegramUser() }) });
  const look = STATE_WORD[a.state];
  return (
    <li className="flex flex-col gap-2 py-3" data-account={a.account}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">Telegram account {a.account}</span>
        <Badge variant={look.badge}>{a.parked ? `${look.word} (${a.parked.replace("_", " ")})` : look.word}</Badge>
        <span className="text-muted-foreground text-xs">{a.stored === 1 ? "1 message stored" : `${a.stored} messages stored`} since the server started</span>
        <span className="ms-auto flex gap-2">
          {asking ? (
            <>
              <ActionButton disabled={off.isPending} onClick={() => off.mutate()} size="s" variant="danger">
                {off.isPending ? "Disconnecting" : "Disconnect and delete the session"}
              </ActionButton>
              <ActionButton disabled={off.isPending} onClick={() => setAsking(false)} size="s" variant="quiet">
                Keep it
              </ActionButton>
            </>
          ) : (
            <ActionButton onClick={() => setAsking(true)} size="s" variant="secondary">
              Disconnect
            </ActionButton>
          )}
        </span>
      </div>
      {asking && <p className="measure text-muted-foreground text-sm">The session file is deleted; the linked chats and their messages stay. To read them again, connect the account again.</p>}
      {a.fix && <p className="measure text-sm text-warning-foreground">{a.fix}</p>}
      {a.lastError && a.state !== "parked" && <p className="measure text-muted-foreground text-sm">{a.lastError}</p>}
      {off.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(off.error)}
        </p>
      )}
    </li>
  );
}

/**
 * Messengers ▸ Settings, Telegram account (P71 M3): the connected account with its state and Disconnect, or the connect form with
 * its risk sentence. When the server keeps Telegram accounts off (`HUB_MESSENGERS=off`, several projects) its reason is the one
 * line above the form; the form still drives the routes, and the server's refusal lands in the form's alert.
 */
export function TelegramAccount() {
  const q = useTelegramUser();
  if (q.isPending) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the Telegram account" />;
  const d = q.data;
  if (d.accounts.length > 0)
    return (
      <ul aria-label="Telegram accounts" className="flex flex-col divide-y border-y">
        {d.accounts.map((a) => (
          <AccountRow a={a} key={a.account} />
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
