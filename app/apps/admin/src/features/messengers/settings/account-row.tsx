import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useState } from "react";
import type { TelegramUserAccountDto } from "@hub/contract/messengers";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { sentence } from "@/lib/api/client";
import { readsLine } from "../labels";

export const STATE_WORD: Record<TelegramUserAccountDto["state"], { word: string; badge: "success" | "warning" | "error" | "outline" }> = {
  running: { word: "Connected", badge: "success" },
  starting: { word: "Connecting", badge: "outline" },
  error: { word: "Failing, retries", badge: "warning" },
  parked: { word: "Parked", badge: "error" },
  stopped: { word: "Stopped", badge: "outline" },
};

/**
 * One connected account of a user-account channel (Telegram since P71 M3, WhatsApp since M5): its name, its state, the fix line of
 * a park, and Disconnect, confirmed in place (it removes the session; `note` says what that means for this channel).
 */
export function AccountRow({ a, label, note, disconnect, statusKey, linked }: { a: TelegramUserAccountDto; label: string; note: string; disconnect: (account: string) => Promise<unknown>; statusKey: QueryKey; linked?: number }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const off = useMutation({ mutationFn: () => disconnect(a.account), onSettled: () => qc.invalidateQueries({ queryKey: statusKey }) });
  const look = STATE_WORD[a.state];
  return (
    <li className="flex flex-col gap-2 py-3" data-account={a.account}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{label}</span>
        <Badge variant={look.badge}>{a.parked ? `${look.word} (${a.parked.replace("_", " ")})` : look.word}</Badge>
        {a.state === "running" && linked !== undefined && <span className="text-sm">{readsLine(linked)}</span>}
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

