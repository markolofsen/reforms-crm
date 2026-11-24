import { useState, type ReactNode } from "react";
import type { MessengerChatDto } from "@hub/contract/messenger-panel";
import type { RecentDialogDto } from "@hub/contract/messengers";
import { ActionButton } from "@hub/ui/product/action-button";
import { StatusMenu, type StatusAction } from "../status/status-menu";
import type { useChatMoves } from "../status/use-moves";
import { CreateClient, recordName, RecordSearch } from "./record-search";
import { useHide } from "./use-hide";

type Moves = ReturnType<typeof useChatMoves>;

/**
 * P141 U3 (decision 0049): a known chat that is not linked, as the autolink's moves take it (Link, Create, Hide). Null for a bot
 * chat, or when the Hub does not know which account reads it (the moves need it).
 */
export function dialogOf(c: MessengerChatDto): RecentDialogDto | null {
  if (c.client || c.channel === "telegram_bot" || !c.identity.account) return null;
  return {
    channel: c.channel,
    account: c.identity.account,
    chatId: c.chatId,
    title: c.title || c.identity.profileName || c.chatId,
    seenAt: c.identity.firstSeen,
    why: c.identity.suggestions.length > 1 ? "ambiguous" : "none",
    by: null,
    candidates: c.identity.suggestions,
    last: c.last ? { at: c.last.at, inbound: c.last.direction === "in" } : null,
    username: c.identity.username,
    phone: c.identity.phone,
  };
}

/**
 * The moves of a known unlinked chat, for its list row and its conversation header: the one state menu, the suggested records
 * with Link, and the search or the Create form the menu opens. `menu` goes where the row or the header puts its actions, `panel`
 * under it.
 */
export function useUnlinkedMoves(project: string, r: RecentDialogDto | null, moves: Moves): { menu: ReactNode; panel: ReactNode } {
  const { hide } = useHide(project);
  const [mode, setMode] = useState<"search" | "create" | null>(null);
  if (!r) return { menu: null, panel: null };
  const done = () => setMode(null);
  const on = (a: StatusAction) => {
    if (a === "link") setMode("search");
    else if (a === "create") setMode("create");
    else if (a === "hide") hide.mutate({ channel: r.channel, chatId: r.chatId, title: r.title });
  };
  const menu = <StatusMenu compact disabled={hide.isPending || moves.pending} name={r.title} onAction={on} s={{ state: "unlinked", canCreate: true }} />;
  const panel = (
    <>
      {r.candidates.length > 0 && mode === null && (
        <div aria-label={`Suggested for ${r.title}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5" role="group">
          {r.candidates.map((c) => (
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
    </>
  );
  return { menu, panel };
}

/** The header's buttons of an unlinked chat (P141 U3): Link, Create and Hide in plain sight, not behind a menu. */
export function UnlinkedHeaderButtons({ project, r, moves, onMode }: { project: string; r: RecentDialogDto; moves: Moves; onMode: (m: "search" | "create") => void }) {
  const { hide } = useHide(project);
  const busy = hide.isPending || moves.pending;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ActionButton disabled={busy} onClick={() => onMode("search")} size="s" variant="primary">Link…</ActionButton>
      <ActionButton disabled={busy} onClick={() => onMode("create")} size="s" variant="secondary">Create client…</ActionButton>
      <ActionButton disabled={busy} onClick={() => hide.mutate({ channel: r.channel, chatId: r.chatId, title: r.title })} size="s" variant="quiet">Hide: not a client</ActionButton>
    </div>
  );
}
