"use client";

import { ListIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Sheet, SheetPopup, SheetTitle, SheetTrigger } from "../ui/sheet";
import { ActionButton } from "./action-button";

/** The width of its own box from which the section menu is a column (60rem); below it, a button opens the same menu in a sheet. */
export const SECTION_NAV_MIN_PX = 960;

/**
 * One section layout (P125 L1, verdicts 1 and 6): the app's rail stays outside; inside, the section's own menu as the second
 * column (`--section-nav-width`, sticky, its own scroll) and the content. The content is a container, so a `ListDetail` inside
 * keeps switching by its own width. Below 960px of the layout's own width the column folds into `navButton` ("Topics"), which
 * opens the same menu in a sheet: a container query, never a width branch in the render (`state-and-data.md` rule 11).
 */
export function SectionLayout({ nav, navLabel, navButton, children }: { nav: ReactNode; navLabel: string; /** The narrow form's button text ("Topics", "Kinds"). */ navButton: string; children: ReactNode }) {
  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-1 overflow-hidden" data-slot="section-layout">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @[60rem]:grid @[60rem]:grid-cols-[var(--section-nav-width)_minmax(0,1fr)]">
        <aside aria-label={navLabel} className="hidden min-h-0 overflow-y-auto overscroll-contain border-e @[60rem]:block">
          {nav}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center px-3 pt-2 @[60rem]:hidden">
            <Sheet>
              <SheetTrigger render={<ActionButton size="s" variant="secondary" />}>
                <ListIcon aria-hidden="true" />
                {navButton}
              </SheetTrigger>
              <SheetPopup side="left">
                <SheetTitle className="px-4 pt-4 text-base">{navLabel}</SheetTitle>
                <div className="min-h-0 overflow-y-auto">{nav}</div>
              </SheetPopup>
            </Sheet>
          </div>
          <div className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-slot="section-content">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
