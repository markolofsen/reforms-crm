"use client";

import type { ReactNode } from "react";
import type { SectionNavForm } from "./section-nav";

/** The width of its own box from which the section menu is a column (40rem); below it, the same menu is a row of tabs on top. */
export const SECTION_NAV_MIN_PX = 640;

/**
 * One section layout (P125 L1, verdicts 1 and 6): the app's rail stays outside; inside, the section's own menu as the second
 * column (sticky, its own scroll) and the content. The content is a container, so a `ListDetail` inside keeps switching by its own
 * width. The column is `--section-nav-compact` from 640px of the layout's own width (the dock panel open beside it) and
 * `--section-nav-width` from 960px; below 640px the same links are one row of tabs above the content (owner 2026-11-25: the column
 * stays as long as it fits, the drawer is gone). Container queries, never a width branch in the render (`state-and-data.md` rule 11):
 * both forms are drawn and the hidden one is out of the accessibility tree.
 */
export function SectionLayout({ nav, navLabel, children }: { nav: (form: SectionNavForm) => ReactNode; navLabel: string; children: ReactNode }) {
  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-1 overflow-hidden" data-slot="section-layout">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @[40rem]:grid @[40rem]:grid-cols-[var(--section-nav-compact)_minmax(0,1fr)] @[60rem]:grid-cols-[var(--section-nav-width)_minmax(0,1fr)]">
        <aside aria-label={navLabel} className="hidden min-h-0 overflow-y-auto overscroll-contain border-e @[40rem]:block">
          {nav("column")}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center px-3 pt-2 @[40rem]:hidden" data-slot="section-tabs">
            {nav("tabs")}
          </div>
          <div className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-slot="section-content">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
