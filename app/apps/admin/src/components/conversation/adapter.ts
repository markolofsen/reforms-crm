import type { ReactNode } from "react";
import type { Dest } from "@/routes/paths";
import type { ListKeyDeps } from "./list/keys";

/**
 * What a channel hands the one conversation workspace (P127 C2, V5): Mail's and Messengers' adapters
 * (`features/mail/adapter.tsx`, `features/messengers/adapter.tsx`) each build one from their `lib/data` module. The adapters keep a
 * client and a chat apart (P108 verdict 1): no identity, route or ref merges here. The cap is eleven members; a third channel
 * difference goes into an existing member or a slot of the workspace, never a new prop.
 */
export type Channel = {
  /** The names of the two panes, and the label of the phone's Back to the list. */
  noun: { list: string; detail: string; back: string };
  /** The rows on screen, in order. */
  ids: readonly number[];
  /** The list has settled for this view and search (no fetch in flight, nothing more to page): only then may a bare list open its first row. */
  settled: boolean;
  /** A row's focus ref (`client:7`, `chat:3`): J/K focus it, Esc returns to it. */
  refOf: (id: number) => string;
  /** The address of one conversation, or of the list (null), the view and search kept. */
  to: (id: number | null) => Dest;
  /** The open conversation: its header, its history and the composer (the open draft, else the manual reply). */
  pane: (id: number, back: () => void) => ReactNode;
  /** The detail when nothing is open. */
  idle: ReactNode;
  /** Mail's multi-select (X, Shift A); a channel without it registers no selection keys (P127 question 4). */
  selection?: ListKeyDeps["selection"];
};

/** The workspace's five slots (section 4e): everything a channel draws around its rows. */
export type ChannelSlots = {
  /** The sticky line on top: the View menu, the search, the channel's own controls. */
  toolbar: ReactNode;
  /** Under the toolbar: Mail's status line, Messengers' Link a chat panel. */
  listTop?: ReactNode;
  /** The rows (a channel draws its own `ConversationRow`s). */
  rows: ReactNode;
  /** A view whose rows are not conversations (Not by email): shown instead of the rows, and nothing opens by itself. */
  body?: ReactNode;
  /** Under the rows: leads, sequence steps, batch send. */
  listBottom?: ReactNode;
  /** A pane that is not a conversation (a lead's card), and whether it is open. */
  aside?: { node: ReactNode; open: boolean; label: string };
};
