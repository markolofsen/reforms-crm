import { useState } from "react";
import type { RecentDialogDto } from "@hub/contract/messengers";
import { sentence } from "@/lib/api/client";
import { ago } from "@/lib/format";
import { ChannelIcon } from "../channel/channel-icon";
import { unlinkedIntro, whyLine, wroteLine } from "../labels";
import { StatusMenu, type StatusAction } from "../status/status-menu";
import type { useChatMoves } from "../status/use-moves";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationList, ConversationListIdentity, ConversationListItem } from "@hub/ui/product/conversation";
import { CreateClient, recordName, RecordSearch } from "./record-search";
import { useHide } from "./use-hide";

type Moves = ReturnType<typeof useChatMoves>;

/**
 * One unlinked chat (P84c, P102): its channel mark, name and when it wrote on one line; a suggested client inline with Link; and
 * the one state menu (Link to a client, Create client, Hide). The reason it was not linked is said only when it is not the common
 * one ("no client has its phone or username"), which the list says once above.
 */
function UnlinkedRow({ project, r, now, moves }: { project: string; r: RecentDialogDto; now: number; moves: Moves }) {
  const { hide } = useHide(project);
  const [mode, setMode] = useState<"search" | "create" | null>(null);
  const suggested = r.candidates.filter((c) => c.email);
  const on = (a: StatusAction) => {
    if (a === "link") setMode("search");
    else if (a === "create") setMode("create");
    else if (a === "hide") hide.mutate({ channel: r.channel, chatId: r.chatId, title: r.title });
  };
  const done = () => setMode(null);
  return (
    <ConversationListItem ariaLabel={r.title} className="flex flex-col gap-1.5 px-3 py-2" dataAttributes={{ "data-recent-chat": `${r.channel}:${r.chatId}` }}>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <ConversationListIdentity leading={<ChannelIcon channel={r.channel} />} name={<span data-agent-label="">{r.title}</span>} />
          {r.last && <span className="mt-0.5 block truncate text-muted-foreground text-xs">{wroteLine(r.last, ago(r.last.at, now))}</span>}
        </div>
        <StatusMenu compact disabled={hide.isPending || moves.pending} name={r.title} onAction={on} s={{ state: "unlinked", canCreate: true }} />
      </div>
      {r.why !== "none" && <p className="measure text-muted-foreground text-sm">{whyLine(r)}</p>}
      {suggested.length > 0 && (
        <div aria-label={`Suggested for ${r.title}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5" role="group">
          {suggested.map((c) => (
            <div className="flex items-center gap-2" key={c.key}>
              <span className="text-sm">
                Suggested: {recordName(c)}
                {c.relationship && <span className="text-muted-foreground"> · {c.relationship}</span>}
              </span>
              <ActionButton disabled={moves.pending} onClick={() => moves.link.mutate({ ...r, rec: c })} size="s" variant="primary">
                Link<span className="sr-only"> {r.title} to {recordName(c)}</span>
              </ActionButton>
            </div>
          ))}
        </div>
      )}
      {mode === "search" && <RecordSearch autoFocus onCancel={done} onLinked={(res) => { void moves.announce(res, r); done(); }} onPick={(rec) => moves.link.mutate({ ...r, rec }, { onSuccess: done })} project={project} r={r} />}
      {mode === "create" && <CreateClient onDone={(res) => { void moves.announce(res, r); done(); }} project={project} r={r} />}
      {moves.link.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(moves.link.error)}
        </p>
      )}
    </ConversationListItem>
  );
}

/**
 * The unlinked chats (P84, P84c, P102; decision 0036 point 3 as amended): on To do the fresh private chats nobody decided on, on
 * Not linked every chat the autolink remembers, of any age; from the server's memory only (nothing of an unlinked chat is stored; a
 * restart empties the list). Said once above them: why they are here; then, on To do, the muted count of unlinked chats that wrote
 * since the server started.
 */
export function UnlinkedChats({ project, rows, freshDays, active, now, noLinked, moves }: { project: string; rows: RecentDialogDto[]; freshDays: number | null; active: number; now: number; /** No linked chat at all: the line says so (P88). */ noLinked: boolean; moves: Moves }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Chats not linked" className="flex flex-col gap-2" data-testid="unlinked-chats">
      <p className="text-muted-foreground text-sm">{unlinkedIntro({ freshDays, count: rows.length, noLinked })}</p>
      <ConversationList ariaLabel="New chats">
        {rows.map((r) => (
          <UnlinkedRow key={`${r.channel}:${r.chatId}`} moves={moves} now={now} project={project} r={r} />
        ))}
      </ConversationList>
      {active > 0 && (
        <p className="text-muted-foreground text-xs">
          {active === 1 ? "1 unlinked chat has" : `${active} unlinked chats have`} written since the server started (counted in memory, never stored).
        </p>
      )}
    </section>
  );
}
