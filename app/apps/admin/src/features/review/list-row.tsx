import { CheckCircle2Icon, CircleDotIcon, CircleIcon, ClockIcon, MailIcon, PauseCircleIcon, type LucideIcon } from "lucide-react";
import { CONVERSATION_STATE_LABELS } from "@hub/contract/conversations";
import { refOf } from "@hub/contract/focus";
import { ActionButton } from "@hub/ui/product/action-button";
import { Badge } from "@hub/ui/badge";
import { Checkbox } from "@hub/ui/checkbox";
import { ConversationListIdentity, ConversationListItem } from "@hub/ui/product/conversation";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import { ago } from "@/lib/format";
import { cn } from "@hub/ui/cn";
import { notionIdentityLine, notionIndicatorState } from "@/lib/notion";
import { isClosed, openResults, rowId, type ConversationRow, type ReviewDraft } from "./source";

type Status = { Icon: LucideIcon; label: string; tone: string };

/** The ONE state of a row (P99 verdict 2): a shape (never colour alone) and its word, which the row also writes out. */
export function statusOf(r: ConversationRow): Status {
  const label = CONVERSATION_STATE_LABELS[r.state];
  if (r.draft?.sendState?.status === "queued") return { Icon: ClockIcon, label: "Send queued", tone: "text-info-foreground" };
  if (r.state === "wrote") return { Icon: MailIcon, label, tone: "text-info-foreground" };
  if (r.state === "draft") return r.draft?.checked ? { Icon: CircleDotIcon, label: "Draft ready, checked", tone: "text-success-foreground" } : { Icon: CircleIcon, label, tone: "text-foreground" };
  if (r.state === "hold") return { Icon: PauseCircleIcon, label, tone: "text-warning-foreground" };
  if (r.state === "waiting") return { Icon: ClockIcon, label, tone: "text-muted-foreground" };
  return { Icon: CheckCircle2Icon, label, tone: "text-success-foreground" };
}

type Chip = { id: string; text: string; variant: "error" | "warning" | "info" | "outline" };

/** At most two chips (verdict 3: what were views are chips): do not contact, suspicious mail, checks, thin basis, a follow-up step, two brands. */
export function chipsOf(r: ConversationRow): Chip[] {
  const out: Chip[] = [];
  const d: ReviewDraft | null = r.draft;
  if (d?.client.marks.includes("do_not_contact")) out.push({ id: "dnc", text: "Do not contact", variant: "error" });
  if (d && d.injectionSuspected && !isClosed(d)) out.push({ id: "injection", text: "Suspicious mail", variant: "error" });
  const pending = d && !isClosed(d) ? openResults(d) : [];
  if (pending.length > 0) out.push({ id: "checks", text: `${pending.length} check${pending.length === 1 ? "" : "s"}`, variant: pending.some((x) => x.level === "red") ? "error" : "warning" });
  if (d && !isClosed(d) && (d.basedOn?.level === "weak" || d.basedOn?.level === "missing")) out.push({ id: "thin", text: "Thin basis", variant: "warning" });
  if (d?.sequence) out.push({ id: "follow-up", text: `Follow-up ${d.sequence.step}/${d.sequence.steps}`, variant: "info" });
  if (r.brands.length > 1) out.push({ id: "brands", text: r.brands.join(" · "), variant: "outline" });
  return out.slice(0, 2);
}

/** The open card's chips (its header): do not contact, suspicious mail, checks, owes a reply. */
export function draftChipsOf(d: ReviewDraft): Chip[] {
  const out: Chip[] = [];
  if (d.client.marks.includes("do_not_contact")) out.push({ id: "dnc", text: "Do not contact", variant: "error" });
  if (d.injectionSuspected && !isClosed(d)) out.push({ id: "injection", text: "Suspicious mail", variant: "error" });
  if (d.client.repliesOwed && !isClosed(d)) out.push({ id: "owes", text: "Owes reply", variant: "info" });
  return out.slice(0, 2);
}

type Props = { r: ConversationRow; now: number; open: boolean; selecting: boolean; selected: boolean; onOpen: () => void; onToggle: () => void };

/**
 * One person in the list (P99 verdict 13), three lines: the name and the time of the newest activity; the state word and the
 * newest thread's subject; their newest message's words (or our draft's) muted, with at most two chips. Three states that never
 * share a look: focus (a ring inset on the button), open (fill and a bar at the start edge) and selected (a checkbox, a tint).
 */
export function ListRow({ r, now, open, selecting, selected, onOpen, onToggle }: Props) {
  const { Icon, label, tone } = statusOf(r);
  const chips = chipsOf(r);
  const id = rowId(r);
  const notionState = notionIndicatorState(r.notion);
  const notionDetail = notionIdentityLine(r.notion, r.client.name);
  return (
    <ConversationListItem className="flex items-stretch" dataAgentRef={refOf("client", id)} dataAttributes={{ "data-state": r.state }} id={`person-${id}`} open={open} selected={selected}>
      <span className="relative grid h-(--control-m) w-(--control-m) shrink-0 place-items-center self-start ms-1 mt-1.5" data-hit="">
        <Icon aria-label={label} className={cn("size-5", tone, selecting ? "opacity-0" : "group-hover/list-item:opacity-0")} role="img" />
        <Checkbox
          aria-label={`Select ${r.client.name}`}
          checked={selected}
          // Not a Tab stop until a selection is under way: `x` selects, `j`/`k` move, and 120 invisible stops stand between Tab and the pane.
          tabIndex={selecting ? 0 : -1}
          className={cn("absolute inset-0 m-auto after:absolute after:-inset-3.5 after:content-['']", !selecting && "opacity-0 focus-visible:opacity-100 group-hover/list-item:opacity-100")}
          onCheckedChange={onToggle}
        />
      </span>
      <ActionButton
        aria-current={open ? "true" : undefined}
        className="min-h-16 min-w-0 flex-1 flex-col items-stretch justify-start gap-0.5 whitespace-normal rounded-none py-2.5 ps-1 pe-2 text-start font-normal outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-slot="conversation-list-focus"
        data-testid="person-row"
        onClick={onOpen}
        size="m"
        variant="quiet"
      >
        <ConversationListIdentity
          marker={<IntegrationStatus compact className="shrink-0" detail={notionDetail} label="Notion" state={notionState} />}
          name={<span data-agent-label="">{r.client.name || r.client.email}</span>}
          nameClassName={r.state === "wrote" || r.state === "draft" ? "font-semibold" : undefined}
          time={ago(r.at, now)}
        />
        {/* At 1280 the list is 360px: a 35-character subject fits whole beside the state only with this end padding and gap
            (ui-specifications 4a: a subject is not cut below 40 characters; measured 4px short with pe-3 and gap-1). */}
        <span className="flex w-full min-w-0 items-baseline gap-0.5 text-sm">
          <span className={cn("shrink-0", r.state === "wrote" || r.state === "draft" ? "font-medium text-foreground" : "text-muted-foreground")} data-testid="person-state">{CONVERSATION_STATE_LABELS[r.state]}</span>
          <span className="min-w-0 truncate" data-testid="person-subject">· {r.subject || "(no subject)"}</span>
        </span>
        {(r.preview || chips.length > 0) && (
          <span className="flex w-full min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
            {r.preview && <span className="min-w-0 flex-1 truncate" data-testid="person-preview">{r.preview}</span>}
            {chips.map((c) => (
              <Badge className="shrink-0" key={c.id} variant={c.variant}>
                {c.text}
              </Badge>
            ))}
          </span>
        )}
      </ActionButton>
    </ConversationListItem>
  );
}
