import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * The width of its own box from which a list and its detail sit side by side (`@3xl`, 48rem; the app's pane hook uses the
 * same number). Its own box, not the viewport: below it the detail becomes its own screen instead of being crushed. 48rem
 * (P88, was 56rem): at 1280px with the rail and the terminal docked at its default 400px the pane is 824px, and the two panes
 * hold there (the list at most 40 % of the box, so the detail keeps about 490px); a wider saved dock drops to one pane.
 */
export const SPLIT_MIN_PX = 768;

/**
 * A list and the detail of its open subject. From 768px of its own width both are on screen (the list 360px, 400px from 1440,
 * never more than 40 % of the box; then the detail); narrower, one at a time, chosen by `showDetail` and switched by a container
 * query, never by a width branch in the render (`state-and-data.md` rule 11). Children may use the same `@3xl:` / `@max-3xl:` variants. Consumer: Drafts.
 */
export function ListDetail({ list, detail, showDetail, listLabel, detailLabel, wide = false }: { list: ReactNode; detail: ReactNode; showDetail: boolean; listLabel: string; detailLabel: string; /** The list is the subject (Activity's table): two thirds of the width. */ wide?: boolean }) {
  return (
    <div className="@container flex min-h-0 min-w-0 flex-1" data-slot="list-detail">
      <div className={cn("flex min-h-0 min-w-0 flex-1 @3xl:grid", wide ? "@3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "@3xl:grid-cols-[min(var(--list-width),40%)_minmax(0,1fr)]")}>
        <section aria-label={listLabel} className={cn("flex min-h-0 min-w-0 flex-1 flex-col @3xl:border-e", showDetail && "@max-3xl:hidden")}>
          {list}
        </section>
        <section aria-label={detailLabel} className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !showDetail && "@max-3xl:hidden")}>
          {detail}
        </section>
      </div>
    </div>
  );
}
