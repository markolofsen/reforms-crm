import { useState } from "react";
import type { TelegramUserAccountDto } from "@hub/contract/messengers";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { sentence } from "@/lib/api/client";
import { useDisconnectAccount } from "@/lib/data/messengers";
import { ChannelIcon } from "../channel/channel-icon";
import { readsLine } from "../labels";

export const STATE_WORD: Record<TelegramUserAccountDto["state"], { word: string; badge: "success" | "warning" | "error" | "outline" }> = {
  running: { word: "Connected", badge: "success" },
  starting: { word: "Connecting", badge: "outline" },
  error: { word: "Failing, retries", badge: "warning" },
  parked: { word: "Needs attention", badge: "error" },
  stopped: { word: "Stopped", badge: "outline" },
};

const PARKED_REASON: Record<NonNullable<TelegramUserAccountDto["parked"]>, string> = {
  logged_out: "Needs reconnect",
  banned: "Restricted",
  flood_wait: "Rate limited",
};

/**
 * One connected account of a user-account channel (Telegram since P71 M3, WhatsApp since M5): its name, its state, the fix line of
 * a park, and Disconnect, confirmed in place (it removes the session; `note` says what that means for this channel).
 */
export function AccountRow({ a, channel, label, note, linked }: { a: TelegramUserAccountDto; channel: "telegram_user" | "whatsapp"; label: string; note: string; linked?: number }) {
  const [asking, setAsking] = useState(false);
  const off = useDisconnectAccount(channel, a.account);
  const look = STATE_WORD[a.state];
  return (
    <li className="flex flex-col gap-1.5 py-2.5" data-account={a.account}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ChannelIcon channel={channel} />
        <span className="min-w-0 flex-1 font-medium text-sm">{label}</span>
        <Badge variant={look.badge}>{a.parked ? `${look.word} · ${PARKED_REASON[a.parked]}` : look.word}</Badge>
        <span className="ms-auto flex shrink-0 gap-2">
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
        {a.state === "running" && linked !== undefined && <span>{readsLine(linked)}</span>}
      </div>
      {asking && <p className="measure text-muted-foreground text-sm">{note}</p>}
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

