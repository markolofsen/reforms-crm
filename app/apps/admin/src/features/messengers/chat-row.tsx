import { useState } from "react";
import type { MessengerChatDto } from "@hub/contract/messenger-panel";
import { ConversationRow } from "@hub/ui/product/conversation-row";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import { AppLink } from "@/components/app-link";
import { ago } from "@/lib/format";
import type { Dest } from "@/routes/paths";
import { ChannelIcon } from "./channel/channel-icon";
import { chatName, chatStateLine, clientName, lastText, notionIdentityLine, notionIndicatorState, unlinkSentence } from "./labels";
import { ReviewDialog } from "@hub/ui/product/review-dialog";
import { sentence } from "@/lib/api/client";
import { StatusMenu, type StatusAction } from "./status/status-menu";
import type { useChatMoves } from "./status/use-moves";
import { RecordSearch } from "./unlinked/record-search";

/**
 * One linked chat on the panel (P71 M3, P102): a compact identity row with its channel mark, Notion state, newest message state
 * and one client-actions menu. The conversation owns drafts and reply actions after opening the row. The search of Change client
 * open under the row; Unlink and Hide are reviewed in the one dialog (P105). Its ref is `chat:<id>`: a Tab onto the row or a press on it tells the agent which chat he means.
 */
export function ChatRow({ c, project, now, moves, to, open = false, replace = false }: { c: MessengerChatDto; project: string; now: number; moves: ReturnType<typeof useChatMoves>; to: Dest; open?: boolean; replace?: boolean }) {
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
    <ConversationRow
      below={
        <>
          {mode === "change" && (
            <div className="border-t px-3 py-2">
              <RecordSearch autoFocus onCancel={done} onPick={(rec) => moves.change.mutate({ id: c.id, key: rec.key, name: chat }, { onSuccess: done })} project={project} />
            </div>
          )}
          {/* P105 S3: a move that deletes is reviewed in the one dialog; the sentence says what goes and what linking again brings back. */}
          <ReviewDialog
            confirmLabel={mode === "hide" ? "Unlink, hide and delete" : "Unlink and delete"}
            items={moves.unlink.isError ? [{ key: "failed", severity: "blocker", text: sentence(moves.unlink.error), action: { label: "Try again", onClick: () => moves.unlink.reset() } }] : []}
            lead={unlinkSentence({ name: chat, client: clientName(c), stored: c.stored, hide: mode === "hide" })}
            onConfirm={() => moves.unlink.mutate({ id: c.id, never: mode === "hide", name: chat }, { onSuccess: done })}
            onOpenChange={(next) => !next && done()}
            open={mode === "unlink" || mode === "hide"}
            pending={moves.unlink.isPending}
            pendingLabel="Unlinking"
            title={mode === "hide" ? `Hide ${chat}: not a client?` : `Unlink ${chat}?`}
            tone="danger"
          />
        </>
      }
      open={open}
      render={(content, className) => (
        <AppLink aria-current={open ? "page" : undefined} bare className={className} data-slot="conversation-list-focus" replace={replace} to={to}>
          {content}
        </AppLink>
      )}
      selected={open}
      summary={{
        ref: `chat:${c.id}`,
        name: heading,
        label: name,
        time: c.last ? ago(c.last.at, now) : undefined,
        strong: c.owed || c.draft !== null,
        state: chatStateLine(c),
        preview: c.last ? lastText(c) : undefined,
        mark: <ChannelIcon channel={c.channel} />,
        marker: notionMarker,
        data: { "data-chat": c.id },
      }}
      trailing={c.channel !== "telegram_bot" ? <StatusMenu compact contact={c.contact} disabled={moves.pending} name={name} onAction={on} s={{ state: "linked", client: clientName(c) }} /> : undefined}
    />
  );
}
