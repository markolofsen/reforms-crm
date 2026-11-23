import { cn } from "../cn";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type IntegrationStatusState = "connected" | "not_found" | "unavailable";

const STATE_LABEL: Record<IntegrationStatusState, string> = {
  connected: "connected",
  not_found: "not found",
  unavailable: "unavailable",
};

/** Compact, accessible status for a contact's external record or integration. */
export function IntegrationStatus({ label, state, detail, className, compact = false, live = false }: { label: string; state: IntegrationStatusState; detail?: string; className?: string; compact?: boolean; live?: boolean }) {
  const text = state === "connected" ? label : `${label} ${STATE_LABEL[state]}`;
  const marker = (
    <span aria-label={compact ? text : undefined} className={cn("inline-flex min-w-0 items-center gap-1 text-muted-foreground text-[11px]", className)} data-slot="integration-status" data-state={state} role={live ? "status" : compact ? "img" : undefined}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", state === "connected" ? "bg-success" : state === "not_found" ? "bg-warning" : "bg-muted-foreground")} />
      {!compact && <span className="min-w-0 truncate">{text}</span>}
    </span>
  );
  if (!detail) return marker;
  return (
    <Tooltip>
      <TooltipTrigger aria-label={detail} render={marker} />
      <TooltipPopup>{detail}</TooltipPopup>
    </Tooltip>
  );
}
