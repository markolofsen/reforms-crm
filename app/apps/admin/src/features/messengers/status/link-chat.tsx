import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import type { AutolinkRecordDto } from "@hub/contract/messengers";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";
import { ChannelIcon } from "../channel/channel-icon";
import { recordName, RecordSearch } from "../unlinked/record-search";
import type { useChatMoves } from "./use-moves";

export type LinkAccount = { channel: "telegram_user" | "whatsapp"; account: string };

/**
 * P102 S4, "Link a chat…" on Chats: the owner starts from the client, not from the chat. He finds the client with the one client
 * search (P100's: Notion, live), then sees the chats of each connected account, the ones whose username or number is the client's
 * first, and links the one he means. The dialogs are read on demand and never stored; a chat already linked says so.
 */
export function LinkChat({ project, accounts, moves, onClose }: { project: string; accounts: readonly LinkAccount[]; moves: ReturnType<typeof useChatMoves>; onClose: () => void }) {
  const [rec, setRec] = useState<AutolinkRecordDto | null>(null);
  const reads = useQueries({
    queries: accounts.map((a) => ({
      queryKey: keys.autolinkDialogs(project, a.channel, a.account, rec?.key ?? ""),
      queryFn: () => messengersApi.dialogsOf(project, { channel: a.channel, account: a.account, key: rec?.key ?? "" }),
      enabled: rec !== null,
      gcTime: 0,
      retry: false,
    })),
  });
  return (
    <section aria-label="Link a chat" className="flex flex-col gap-2 border-b bg-muted/20 px-3 py-2.5 sm:px-4" data-testid="link-chat">
      {rec === null ? (
        <>
          <p className="text-sm">Which client is the chat of?</p>
          <RecordSearch autoFocus onCancel={onClose} onPick={setRec} project={project} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 text-sm">
              Chats to link to <span className="font-medium">{recordName(rec)}</span>
            </p>
            <ActionButton onClick={() => setRec(null)} size="s" variant="quiet">
              Another client
            </ActionButton>
            <ActionButton className="ms-auto" onClick={onClose} size="s" variant="quiet">
              Close
            </ActionButton>
          </div>
          {accounts.map((a, i) => {
            const q = reads[i];
            return (
              <div className="flex flex-col gap-1" key={`${a.channel}:${a.account}`}>
                {q?.isPending && <p className="text-muted-foreground text-sm">Reading the chats of {a.account}…</p>}
                {q?.isError && <p className="text-destructive-foreground text-sm" role="alert">{sentence(q.error)}</p>}
                {q?.data && q.data.dialogs.length === 0 && <p className="text-muted-foreground text-sm">No chat on {a.account}.</p>}
                {q?.data && q.data.dialogs.length > 0 && (
                  <ul aria-label={`Chats of ${a.account}`} className="flex flex-col divide-y border-y">
                    {q.data.dialogs.map((d) => (
                      <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2" data-dialog={`${a.channel}:${d.chatId}`} key={d.chatId}>
                        <ChannelIcon channel={a.channel} />
                        <span className="text-sm">{d.title}</span>
                        {d.username && <span className="text-muted-foreground text-xs">@{d.username.replace(/^@/, "")}</span>}
                        {d.suggested && <Badge variant="outline">Matches {recordName(rec)}</Badge>}
                        <span className="ms-auto">
                          {d.linked ? (
                            <Badge variant="outline">Already linked</Badge>
                          ) : (
                            <ActionButton disabled={moves.pending} onClick={() => moves.link.mutate({ channel: a.channel, account: a.account, chatId: d.chatId, title: d.title, rec }, { onSuccess: onClose })} size="s" variant={d.suggested ? "primary" : "secondary"}>
                              Link<span className="sr-only"> {d.title} to {recordName(rec)}</span>
                            </ActionButton>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
