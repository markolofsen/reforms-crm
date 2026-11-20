import type { MessengerChatDto } from "@hub/contract/messenger-panel";
import { cn } from "@hub/ui/cn";
import { ago } from "@/lib/format";
import { agentRef } from "@/lib/focus";
import { DraftBlock } from "./draft-block";
import { chatName, lastText, lastWho, noDraftLine, rulesLine } from "./labels";
import type { useChatActions } from "./use-chat-actions";

/** The inset ring of a row he can point at (P72, `accessibility.md` rule 3). */
const POINTABLE = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * One linked chat on the panel (P71 M3): who it is and its rules, the newest stored message (whose turn it is), and the agent's
 * open draft with Send, Edit and Skip, or the line that says why there is none. Three columns from 1024px, stacked below; nothing
 * is behind a click. Its ref is `chat:<id>`: a Tab onto the row or a press on it tells the agent which chat he means.
 */
export function ChatRow({ c, project, now, actions }: { c: MessengerChatDto; project: string; now: number; actions: ReturnType<typeof useChatActions> }) {
  const name = chatName(c);
  const who = lastWho(c);
  const none = noDraftLine(c, project);
  return (
    <li aria-label={name} className={cn("grid gap-3 px-1 py-3 lg:grid-cols-[20%_minmax(0,32%)_minmax(0,1fr)] lg:gap-4", POINTABLE)} data-chat={c.id} tabIndex={0} {...agentRef(`chat:${c.id}`)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="break-words font-medium text-sm" data-agent-label="">
          {name}
        </span>
        <span className="text-muted-foreground text-xs">{rulesLine(c)}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        {who && c.last && (
          <span className={c.owed ? "text-warning-foreground text-xs" : "text-muted-foreground text-xs"}>
            {who} · {ago(c.last.at, now)}
          </span>
        )}
        <p className="whitespace-pre-wrap break-words text-sm">{lastText(c)}</p>
      </div>
      {c.draft ? <DraftBlock actions={actions} d={c.draft} name={name} /> : <p className="text-muted-foreground text-sm">{none}</p>}
    </li>
  );
}
