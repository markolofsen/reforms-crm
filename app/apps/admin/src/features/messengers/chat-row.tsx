import { useState } from "react";
import type { MessengerChatDto } from "@hub/contract/messenger-panel";
import { cn } from "@hub/ui/cn";
import { ago } from "@/lib/format";
import { agentRef } from "@/lib/focus";
import { ChannelIcon } from "./channel/channel-icon";
import { DraftBlock } from "./draft-block";
import { chatName, clientName, lastText, lastWho, noDraftLine, rulesLine, triageLine, unlinkSentence } from "./labels";
import { Confirm } from "./status/row-panel";
import { StatusMenu, type StatusAction } from "./status/status-menu";
import type { useChatMoves } from "./status/use-moves";
import { RecordSearch } from "./unlinked/record-search";
import type { useChatActions } from "./use-chat-actions";

/** The inset ring of a row he can point at (P72, `accessibility.md` rule 3). */
const POINTABLE = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * One linked chat on the panel (P71 M3, P102): the chat's name with its channel mark, the state menu (Linked to the client: Change
 * client, Unlink, Hide) and its rules, the newest stored message (whose turn it is), and the agent's open draft with Send, Edit and
 * Skip, or the line that says why there is none. Three columns from 1024px, stacked below. The search of Change client and the
 * confirmation of Unlink open under the row. Its ref is `chat:<id>`: a Tab onto the row or a press on it tells the agent which chat he means.
 */
export function ChatRow({ c, project, now, actions, moves }: { c: MessengerChatDto; project: string; now: number; actions: ReturnType<typeof useChatActions>; moves: ReturnType<typeof useChatMoves> }) {
  const [mode, setMode] = useState<"change" | "unlink" | "hide" | null>(null);
  const name = chatName(c);
  const heading = c.title || name;
  const done = () => setMode(null);
  const on = (a: StatusAction) => setMode(a === "change" ? "change" : a === "unlink" ? "unlink" : a === "hide-linked" ? "hide" : null);
  const who = lastWho(c);
  const none = noDraftLine(c, project);
  const triage = triageLine(c);
  return (
    <li aria-label={name} className={cn("grid gap-3 px-1 py-3 lg:grid-cols-[20%_minmax(0,32%)_minmax(0,1fr)] lg:gap-4", POINTABLE)} data-chat={c.id} tabIndex={0} {...agentRef(`chat:${c.id}`)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <ChannelIcon channel={c.channel} />
          <span className="break-words font-medium text-sm" data-agent-label="">
            {heading}
          </span>
        </span>
        {c.channel !== "telegram_bot" && (
          <span className="-ms-2">
            <StatusMenu disabled={moves.pending} name={name} onAction={on} s={{ state: "linked", client: clientName(c) }} />
          </span>
        )}
        <span className="text-muted-foreground text-xs">{rulesLine(c)}</span>
        {triage && (
          <span className="text-muted-foreground text-xs" data-triage="">
            {triage}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        {who && c.last && (
          <span className={c.owed ? "text-warning-foreground text-xs" : "text-muted-foreground text-xs"}>
            {who} · {ago(c.last.at, now)}
          </span>
        )}
        <p className="whitespace-pre-wrap break-words text-sm">{lastText(c)}</p>
      </div>
      {c.draft ? <DraftBlock actions={actions} d={c.draft} name={name} project={project} /> : <p className="text-muted-foreground text-sm">{none}</p>}
      {mode === "change" && (
        <div className="lg:col-span-3">
          <RecordSearch onCancel={done} onPick={(rec) => moves.change.mutate({ id: c.id, key: rec.key, name: heading }, { onSuccess: done })} project={project} />
        </div>
      )}
      {(mode === "unlink" || mode === "hide") && (
        <div className="lg:col-span-3">
          <Confirm
            act={mode === "hide" ? "Unlink, hide and delete" : "Unlink and delete"}
            onCancel={done}
            onConfirm={() => moves.unlink.mutate({ id: c.id, never: mode === "hide", name: heading }, { onSuccess: done })}
            pending={moves.unlink.isPending}
            sentence={unlinkSentence({ name: heading, client: clientName(c), stored: c.stored, hide: mode === "hide" })}
          />
        </div>
      )}
    </li>
  );
}
