import type { ReactNode } from "react";
import { cn } from "../../cn";

/**
 * The one page shell of a single-column screen (Activity on a phone, Project, Connections, Overview): an optional header line
 * (the title is the section, or `nav`, the sub-nav of a section with child pages, P63; actions at the end) and a body that fills
 * the pane and scrolls. Full width: no page container, prose blocks take the `measure` utility themselves (P48).
 * `label`: a body that may scroll with nothing focusable in it (a table of plain rows, Activity) becomes a named region a keyboard
 * can reach, so it scrolls without a mouse (WCAG 2.1.1, axe `scrollable-region-focusable`).
 */
export function Page({ title, nav, actions, children, className, label, flush = false, scroll = true }: { title?: ReactNode; nav?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; label?: string; flush?: boolean; scroll?: boolean }) {
  const region = scroll && label ? { role: "region" as const, "aria-label": label, tabIndex: 0 } : {};
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", scroll ? "overflow-y-auto" : "overflow-hidden")} data-slot="page" {...region}>
      {(title || nav || actions) && (
        <div className="flex min-h-14 flex-wrap items-center gap-3 border-b px-4 py-2 sm:px-6" data-slot="page-header">
          {title && <h1 className="min-w-0 flex-1 font-heading font-semibold text-base">{title}</h1>}
          {nav && <div className="min-w-0 flex-1">{nav}</div>}
          {actions && <div className="ms-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("flex min-h-0 flex-1 w-full flex-col gap-4 p-4 sm:p-6", flush && "gap-0 overflow-hidden p-0 sm:p-0", className)} data-slot="page-body">
        {children}
      </div>
    </div>
  );
}

/**
 * The heading of a group inside a page (UX pass 2026-11-20, the admin's `design-system-and-tokens.md` rule 14): sentence case,
 * `font-heading`, medium, small, in the foreground colour. One look for every group, never an eyebrow in capitals beside a
 * sentence-case one. The page's own title is the shell's (or `Page`'s `title`).
 */
export function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 className="font-heading font-medium text-sm" id={id}>
      {children}
    </h3>
  );
}
