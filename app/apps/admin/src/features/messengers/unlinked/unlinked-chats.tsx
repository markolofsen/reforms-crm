import { InfoIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { RecentDialogDto } from "@hub/contract/messengers";
import { sentence } from "@/lib/api/client";
import { ago } from "@/lib/format";
import { ChannelIcon } from "../channel/channel-icon";
import { unlinkedHeading, unlinkedIntro, whyLine, wroteLine } from "../labels";
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
  const suggested = r.candidates;
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
 * restart empties the list). Under one group heading, "Not linked · N" (P138 verdict 9), why they are here in its tooltip (P128 X5
 * dropped the "since the server started" count).
 */
export function UnlinkedChats({ project, rows, freshDays, now, noLinked, moves, action }: { project: string; rows: RecentDialogDto[]; freshDays: number | null; now: number; /** No linked chat at all: the heading says so (P88). */ noLinked: boolean; moves: Moves; /** P138 verdict 9: the agent's proposed hides, on the heading's line. */ action?: ReactNode }) {
  if (rows.length === 0) return null;
  const rule = unlinkedIntro({ freshDays, count: rows.length, noLinked: false });
  return (
    <section aria-labelledby="unlinked-heading" className="flex flex-col" data-testid="unlinked-chats">
      {/* P138 verdict 9: a group heading with the list's padding, the rule in its tooltip; the proposed hides on the same line. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1 border-b bg-muted/30 px-3 py-1" data-testid="unlinked-heading">
        <h4 className="min-w-0 font-medium text-muted-foreground text-xs" id="unlinked-heading">
          {unlinkedHeading({ count: rows.length, noLinked })}
        </h4>
        <ActionButton aria-label={`Why: ${rule}`} icon size="s" tooltip={rule} variant="quiet">
          <InfoIcon aria-hidden="true" />
        </ActionButton>
        {action && <div className="ms-auto flex items-center gap-1">{action}</div>}
      </div>
      <ConversationList ariaLabel="New chats">
        {rows.map((r) => (
          <UnlinkedRow key={`${r.channel}:${r.chatId}`} moves={moves} now={now} project={project} r={r} />
        ))}
      </ConversationList>
    </section>
  );
}
