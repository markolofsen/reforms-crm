"use client";

import type { ReactNode } from "react";

/** The width of its own box from which the section menu column is its full width (60rem); below it, compact. */
export const SECTION_NAV_WIDE_PX = 960;

/**
 * One section layout (P125 L1, verdicts 1 and 6): the app's rail stays outside; inside, the section's own menu as the second
 * column (sticky, its own scroll) and the content. The content is a container, so a `ListDetail` inside keeps switching by its own
 * width. The column is there at every width (owner 2026-11-25: «чтобы всегда была колонка»; no drawer, no tabs): `--section-nav-width`
 * from 960px of the layout's own width, `--section-nav-compact` below it (the dock panel open, the rail, the phone). A container
 * query, never a width branch in the render (`state-and-data.md` rule 11).
 */
export function SectionLayout({ nav, navLabel, children }: { nav: ReactNode; navLabel: string; children: ReactNode }) {
  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-1 overflow-hidden" data-slot="section-layout">
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[var(--section-nav-compact)_minmax(0,1fr)] @[60rem]:grid-cols-[var(--section-nav-width)_minmax(0,1fr)]">
        <aside aria-label={navLabel} className="min-h-0 overflow-y-auto overscroll-contain border-e">
          {nav}
        </aside>
        <div className="@container flex min-h-0 min-w-0 flex-col overflow-hidden" data-slot="section-content">
          {children}
        </div>
      </div>
    </div>
  );
}
