import { useState } from "react";
import type { MessengerChatDto } from "@hub/contract/messenger-panel";
import { cn } from "@hub/ui/cn";
import { ConversationListIdentity, ConversationListItem } from "@hub/ui/product/conversation";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import { AppLink } from "@/components/app-link";
import { ago } from "@/lib/format";
import type { Dest } from "@/routes/paths";
import { ChannelIcon } from "./channel/channel-icon";
import { chatName, chatStateLine, clientName, lastText, notionIdentityLine, notionIndicatorState, unlinkSentence } from "./labels";
import { Confirm } from "./status/row-panel";
import { StatusMenu, type StatusAction } from "./status/status-menu";
import type { useChatMoves } from "./status/use-moves";
import { RecordSearch } from "./unlinked/record-search";

/** The inset ring of a row he can point at (P72, `accessibility.md` rule 3). */
const POINTABLE = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * One linked chat on the panel (P71 M3, P102): a compact identity row with its channel mark, Notion state, newest message state
 * and one client-actions menu. The conversation owns drafts and reply actions after opening the row. The search of Change client
 * and the confirmation of Unlink open under the row. Its ref is `chat:<id>`: a Tab onto the row or a press on it tells the agent which chat he means.
 */
export function ChatRow({ c, project, now, moves, to, open = false }: { c: MessengerChatDto; project: string; now: number; moves: ReturnType<typeof useChatMoves>; to: Dest; open?: boolean }) {
  const [mode, setMode] = useState<"change" | "unlink" | "hide" | null>(null);
  const name = chatName(c);
  const heading = c.client ? name : c.title || name;
  // The moves name the chat by its own title, not by the client the row leads with: "Unlink Rita F. from Rita Falsa".
  const chat = c.title || name;
  const done = () => setMode(null);
  const on = (a: StatusAction) => setMode(a === "change" ? "change" : a === "unlink" ? "unlink" : a === "hide-linked" ? "hide" : null);
  const notionState = notionIndicatorState(c);
  const notionMarker = notionState ? <IntegrationStatus compact className="shrink-0" detail={notionIdentityLine(c) ?? undefined} label="Notion" state={notionState} /> : null;
  return (
    <ConversationListItem ariaLabel={name} dataAgentRef={`chat:${c.id}`} dataAttributes={{ "data-chat": c.id }} open={open} selected={open}>
      <div className="relative min-w-0">
        <AppLink aria-current={open ? "page" : undefined} bare className={cn("w-full min-w-0 justify-start rounded-none px-3 py-2 text-start", c.channel !== "telegram_bot" && "pe-14 lg:pe-12", POINTABLE)} data-slot="conversation-list-focus" to={to}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <ConversationListIdentity leading={<ChannelIcon channel={c.channel} />} marker={notionMarker} name={<span data-agent-label="">{heading}</span>} time={c.last ? ago(c.last.at, now) : undefined} />
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
              <span className="min-w-0 flex-1 truncate" data-chat-state="">{chatStateLine(c)}{c.last ? ` · ${lastText(c)}` : ""}</span>
            </span>
          </span>
        </AppLink>
        {c.channel !== "telegram_bot" && (
          <div className="absolute end-2 top-2 z-10">
            <StatusMenu compact disabled={moves.pending} name={name} onAction={on} s={{ state: "linked", client: clientName(c) }} />
          </div>
        )}
      </div>
      {mode === "change" && (
        <div className="border-t px-3 py-2">
          <RecordSearch autoFocus onCancel={done} onPick={(rec) => moves.change.mutate({ id: c.id, key: rec.key, name: chat }, { onSuccess: done })} project={project} />
        </div>
      )}
      {(mode === "unlink" || mode === "hide") && (
        <div className="border-t px-3 py-2">
          <Confirm
            act={mode === "hide" ? "Unlink, hide and delete" : "Unlink and delete"}
            onCancel={done}
            onConfirm={() => moves.unlink.mutate({ id: c.id, never: mode === "hide", name: chat }, { onSuccess: done })}
            pending={moves.unlink.isPending}
            sentence={unlinkSentence({ name: chat, client: clientName(c), stored: c.stored, hide: mode === "hide" })}
          />
        </div>
      )}
    </ConversationListItem>
  );
}
