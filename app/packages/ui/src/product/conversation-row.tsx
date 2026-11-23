import type { ReactNode } from "react";
import { Badge } from "../ui/badge";
import { cn } from "../cn";
import { ConversationListIdentity, ConversationListItem } from "./conversation";

/** At most two chips under a row: do not contact, suspicious mail, checks, a follow-up step, brands. */
export type ConversationChip = { id: string; text: string; variant: "error" | "warning" | "info" | "outline" };

/**
 * What a row says, the same three lines in both channels (P127 V7, P123 U3): the name and the time; the state word and a
 * subject; the newest words (or the agent's verdict) with at most two chips. A channel builds it from its own row; this view
 * never learns whether it draws a client or a chat.
 */
export type ConversationSummary = {
  /** The focus ref (`client:7`, `chat:3`): the agent hears which row he points at. */
  ref: string;
  /** The DOM id (`person-7`): the list keys scroll and focus by it. */
  domId?: string;
  name: ReactNode;
  /** The label a screen reader names the row by when `name` is not plain text. */
  label: string;
  time?: string;
  /** A reply is owed or a draft waits: the name and the state word are strong. */
  strong: boolean;
  /** The state word ("Wrote you", "Draft ready"); the second line starts with it. */
  state: string;
  /** After the state word: Mail's subject. */
  subject?: string;
  /** The third line: their newest words, or the agent's verdict (`agent`, drawn in the foreground colour). */
  preview?: string;
  agent?: string;
  chips?: readonly ConversationChip[];
  /** Before the name: a channel mark. */
  mark?: ReactNode;
  /** Beside the name: the Notion state. */
  marker?: ReactNode;
  /** `data-*` attributes the tests and the e2e read (`data-state`, `data-chat`). */
  data?: Readonly<Record<string, string | number | boolean | undefined>>;
};

/** The class list of the row's one link: the focus ring is inset, so a row he points at is ringed inside the list (`accessibility.md` rule 3). */
export const ROW_LINK_CLASS =
  "flex min-h-16 min-w-0 flex-1 flex-col items-stretch justify-start gap-0.5 rounded-none py-2.5 ps-3 pe-2 text-start font-normal outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * One conversation in a list (P127 C1): one link (`render` draws it, the app's `AppLink`: this package knows no router), an
 * optional leading control (Mail's checkbox) and trailing one (Messengers' row menu), and `below` for what opens under the row
 * (Change client's search, a dialog). Three states that never share a look: focus (the inset ring), open (fill and a bar at the
 * start edge) and selected (a tint).
 */
export function ConversationRow({ summary: s, open = false, selected = false, leading, trailing, below, render }: {
  summary: ConversationSummary;
  open?: boolean;
  selected?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  below?: ReactNode;
  render: (content: ReactNode, className: string) => ReactNode;
}) {
  const chips = s.chips ?? [];
  const content = (
    <>
      <ConversationListIdentity leading={s.mark} marker={s.marker} name={<span data-agent-label="">{s.name}</span>} nameClassName={s.strong ? "font-semibold" : undefined} time={s.time} />
      {/* At 1280 the list is 360px: a 35-character subject fits whole beside the state only with this end padding and gap
          (ui-specifications 4a: a subject is not cut below 40 characters). */}
      <span className="flex w-full min-w-0 items-baseline gap-0.5 text-sm">
        <span className={cn("shrink-0", s.strong ? "font-medium text-foreground" : "text-muted-foreground")} data-testid="person-state">{s.state}</span>
        {s.subject !== undefined && <span className="min-w-0 truncate" data-testid="person-subject">· {s.subject || "(no subject)"}</span>}
      </span>
      {(s.agent || s.preview || chips.length > 0) && (
        <span className="flex w-full min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          {/* P128 X2: the agent's judgement replaces their words on the third line. */}
          {s.agent ? <span className="min-w-0 flex-1 truncate text-foreground" data-testid="person-agent">{s.agent}</span> : s.preview && <span className="min-w-0 flex-1 truncate" data-testid="person-preview">{s.preview}</span>}
          {chips.map((c) => (
            <Badge className="shrink-0" key={c.id} variant={c.variant}>
              {c.text}
            </Badge>
          ))}
        </span>
      )}
    </>
  );
  return (
    <ConversationListItem ariaLabel={s.label} className="flex flex-col" dataAgentRef={s.ref} dataAttributes={s.data} id={s.domId} open={open} selected={selected}>
      <div className="relative flex min-w-0 items-stretch">
        {leading}
        {render(content, cn(ROW_LINK_CLASS, leading ? "ps-1" : undefined, trailing ? "pe-14 lg:pe-12" : undefined))}
        {trailing && <div className="absolute end-2 top-2 z-10">{trailing}</div>}
      </div>
      {below}
    </ConversationListItem>
  );
}
