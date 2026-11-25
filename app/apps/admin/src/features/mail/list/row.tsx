import { CheckCircle2Icon, CircleDotIcon, CircleIcon, ClockIcon, MailIcon, PauseCircleIcon, type LucideIcon } from "lucide-react";
import { CONVERSATION_STATE_LABELS } from "@hub/contract/conversations";
import { refOf } from "@hub/contract/focus";
import { Checkbox } from "@hub/ui/checkbox";
import { ConversationRow as Row, type ConversationChip, type ConversationSummary } from "@hub/ui/product/list/conversation-row";
import { AppLink } from "@/components/app-link";
import type { Dest } from "@/routes/paths";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import { ago } from "@/lib/format";
import { cn } from "@hub/ui/cn";
import { notionIdentityLine, notionIndicatorState } from "@/lib/notion";
import { isClosed, openResults, rowId, type ConversationRow, type ReviewDraft } from "@/features/mail/model";
import { agentLine } from "@/lib/agent-reasons";

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

type Chip = ConversationChip;

/** At most two chips (verdict 3: what were views are chips): do not contact, suspicious mail, checks, a sequence step, the follow-up plan (P142), two brands. */
export function chipsOf(r: ConversationRow, followUp: string | null = null): Chip[] {
  const out: Chip[] = [];
  const d: ReviewDraft | null = r.draft;
  if (d?.client.marks.includes("do_not_contact")) out.push({ id: "dnc", text: "Do not contact", variant: "error" });
  if (d && d.injectionSuspected && !isClosed(d)) out.push({ id: "injection", text: "Suspicious mail", variant: "error" });
  const pending = d && !isClosed(d) ? openResults(d) : [];
  if (pending.length > 0) out.push({ id: "checks", text: `${pending.length} check${pending.length === 1 ? "" : "s"}`, variant: pending.some((x) => x.level === "red") ? "error" : "warning" });
  if (d?.sequence) out.push({ id: "sequence-step", text: `Step ${d.sequence.step}/${d.sequence.steps}`, variant: "info" });
  if (followUp) out.push({ id: "follow-up", text: followUp, variant: "info" });
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

/** Mail's row as the shared three lines (P127 C1): the person, the state word and subject, their words or the agent's verdict. */
export function summaryOf(r: ConversationRow, now: number, followUp: string | null = null): ConversationSummary {
  const id = rowId(r);
  const name = r.client.name || r.client.email;
  return {
    ref: refOf("client", id),
    domId: `person-${id}`,
    name,
    label: name,
    time: ago(r.at, now),
    strong: r.state === "wrote" || r.state === "draft",
    state: CONVERSATION_STATE_LABELS[r.state],
    subject: r.subject,
    preview: r.preview || undefined,
    agent: r.agent ? agentLine(r.agent) : undefined,
    chips: chipsOf(r, followUp),
    marker: <IntegrationStatus compact className="shrink-0" detail={notionIdentityLine(r.notion, r.client.name)} label="Notion" state={notionIndicatorState(r.notion)} />,
    data: { "data-state": r.state },
  };
}

/** `followUp`: the plan's chip word (P142, "Follow-up 30 Nov"), from the project's one follow-ups list. */
type Props = { r: ConversationRow; now: number; open: boolean; selecting: boolean; selected: boolean; to: Dest; replace: boolean; onToggle: () => void; followUp?: string | null };

/**
 * One person in the list (P99 verdict 13), drawn by the shared `ConversationRow`: a real link to `/mail/c/<email>` (routes rule 7,
 * P128 F20; open in a new tab works), replacing the entry while a conversation is open (routes rule 9). The leading control is the
 * state shape, which becomes the checkbox on hover or while a selection is under way.
 */
export function ListRow({ r, now, open, selecting, selected, to, replace, onToggle, followUp = null }: Props) {
  const { Icon, label, tone } = statusOf(r);
  const leading = (
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
  );
  return (
    <Row
      leading={leading}
      open={open}
      render={(content, className) => (
        <AppLink aria-current={open ? "page" : undefined} bare className={className} data-slot="conversation-list-focus" data-testid="person-row" replace={replace} to={to}>
          {content}
        </AppLink>
      )}
      selected={selected}
      summary={summaryOf(r, now, followUp)}
    />
  );
}
