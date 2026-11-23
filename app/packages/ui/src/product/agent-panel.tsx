import { type ReactNode } from "react";
import { cn } from "../cn";

type AgentPanelFrameProps = {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/** Presentational shell for an agent surface: fixed chrome around a flexible work area. */
export function AgentPanelFrame({ children, header, footer, className }: AgentPanelFrameProps) {
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background", className)} data-slot="agent-panel">
      {header && <div className="min-w-0 shrink-0" data-slot="agent-panel-header">{header}</div>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-slot="agent-panel-body">{children}</div>
      {footer && <div className="min-w-0 shrink-0 border-t bg-background" data-slot="agent-panel-footer">{footer}</div>}
    </div>
  );
}
