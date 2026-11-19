import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * The one page shell of a single-column screen (Activity on a phone, Project, Connections, Overview): an optional header line
 * (the title is the section, or `nav`, the sub-nav of a section with child pages, P63; actions at the end) and a body that fills
 * the pane and scrolls. Full width: no page container, prose blocks take the `measure` utility themselves (P48).
 */
export function Page({ title, nav, actions, children, className }: { title?: ReactNode; nav?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-slot="page">
      {(title || nav || actions) && (
        <div className="flex min-h-14 flex-wrap items-center gap-3 border-b px-4 py-2 sm:px-6" data-slot="page-header">
          {title && <h1 className="min-w-0 flex-1 font-heading font-semibold text-base">{title}</h1>}
          {nav && <div className="min-w-0 flex-1">{nav}</div>}
          {actions && <div className="ms-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("flex w-full flex-col gap-4 p-4 sm:p-6", className)} data-slot="page-body">
        {children}
      </div>
    </div>
  );
}
