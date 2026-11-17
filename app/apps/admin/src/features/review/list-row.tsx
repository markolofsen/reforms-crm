import { CheckCircle2Icon, CircleDotIcon, CircleIcon, ClockIcon, MinusCircleIcon, PauseCircleIcon, type LucideIcon } from "lucide-react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Badge } from "@hub/ui/badge";
import { Checkbox } from "@hub/ui/checkbox";
import { isOld, silence } from "@/lib/format";
import { cn } from "@hub/ui/cn";
import { isClosed, openResults, type ReviewDraft } from "./source";

type Status = { Icon: LucideIcon; label: string; tone: string };

/** The ONE status indicator of a row: a shape (never colour alone) with its words for assistive tech. */
export function statusOf(d: ReviewDraft): Status {
  if (d.sendState?.status === "queued") return { Icon: ClockIcon, label: "Send queued", tone: "text-info-foreground" };
  if (d.status === "sent" || d.sendState?.status === "sent" || d.status === "done") return { Icon: CheckCircle2Icon, label: d.status === "sent" || d.sendState?.status === "sent" ? "Sent" : "Done", tone: "text-success-foreground" };
  if (d.status === "skipped") return { Icon: MinusCircleIcon, label: "Skipped", tone: "text-muted-foreground" };
  if (d.status === "hold") return { Icon: PauseCircleIcon, label: "On hold", tone: "text-warning-foreground" };
  if (d.checked) return { Icon: CircleDotIcon, label: "Ready to send", tone: "text-success-foreground" };
  return { Icon: CircleIcon, label: "To review", tone: "text-muted-foreground" };
}

type Chip = { id: "dnc" | "injection" | "checks" | "owes"; text: string; variant: "error" | "warning" | "info"; label?: string };

/** At most two chips, in the priority of research 16 section 6.3: do not contact, suspicious mail, checks, owes a reply. */
export function chipsOf(d: ReviewDraft): Chip[] {
  const out: Chip[] = [];
  if (d.client.marks.includes("do_not_contact")) out.push({ id: "dnc", text: "Do not contact", variant: "error" });
  if (d.injectionSuspected && !isClosed(d)) out.push({ id: "injection", text: "Suspicious mail", variant: "error" });
  const pending = openResults(d);
  if (!isClosed(d) && pending.length > 0) out.push({ id: "checks", text: `${pending.length} check${pending.length === 1 ? "" : "s"}`, variant: pending.some((r) => r.level === "red") ? "error" : "warning" });
  if (d.client.repliesOwed && !isClosed(d)) out.push({ id: "owes", text: "Owes reply", variant: "info" });
  return out.slice(0, 2);
}

type Props = { d: ReviewDraft; now: number; open: boolean; selecting: boolean; selected: boolean; onOpen: () => void; onToggle: () => void };

/**
 * One draft in the list. Three states that never share a look: focus (inset ring on the button), open (fill and a
 * bar at the start edge: its card is in the pane) and selected (the leading slot is a checkbox, a blue tint).
 */
export function ListRow({ d, now, open, selecting, selected, onOpen, onToggle }: Props) {
  const { Icon, label, tone } = statusOf(d);
  const chips = chipsOf(d);
  const old = d.status === "ready" && isOld(d.updatedAt, now);
  return (
    <li className={cn("group/row relative flex min-w-0 items-stretch border-b", open ? "bg-accent" : selected && "bg-info/8")} data-open={open} data-selected={selected} id={`draft-${d.id}`}>
      {open && <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[3px] bg-primary" />}
      <span className="relative grid h-(--control-m) w-(--control-m) shrink-0 place-items-center self-start ms-1 mt-1" data-hit="">
        <Icon aria-label={label} className={cn("size-5", tone, selecting ? "opacity-0" : "group-hover/row:opacity-0")} role="img" />
        <Checkbox
          aria-label={`Select ${d.client.name}`}
          checked={selected}
          // Not a Tab stop until a selection is under way: `x` selects, `j`/`k` move, and 120 invisible stops stand between Tab and the card.
          tabIndex={selecting ? 0 : -1}
          className={cn("absolute inset-0 m-auto after:absolute after:-inset-3.5 after:content-['']", !selecting && "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100")}
          onCheckedChange={onToggle}
        />
      </span>
      <ActionButton
        aria-current={open ? "true" : undefined}
        className="h-auto min-h-(--control-m) min-w-0 flex-1 flex-col items-stretch justify-start gap-0.5 whitespace-normal rounded-none py-2 ps-1 pe-3 text-start font-normal hover:bg-transparent focus-visible:ring-inset"
        onClick={onOpen}
        size="m"
        variant="quiet"
      >
        <span className="flex w-full min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{d.client.name}</span>
          <span className={cn("shrink-0 text-xs tabular-nums", old ? "text-warning-foreground" : "text-muted-foreground")}>{silence(d.client.lastContactAt, now)}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <span className="min-w-0 flex-1 truncate">{[d.mailClass, d.reason ?? d.subject].filter(Boolean).join(" · ")}</span>
          {chips.map((c) => (
            <Badge key={c.text} variant={c.variant}>
              {c.text}
            </Badge>
          ))}
        </span>
      </ActionButton>
    </li>
  );
}
