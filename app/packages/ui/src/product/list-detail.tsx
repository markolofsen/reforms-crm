import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * The width of its own box from which a list and its detail sit side by side (`@4xl`, 56rem; the app's pane hook uses the
 * same number). Its own box, not the viewport: with the terminal docked at 1280px the pane is about 660px, so the detail
 * becomes its own screen instead of being crushed. 56rem and not 64rem: at a 1024px viewport the pane beside the rail is 968px.
 */
export const SPLIT_MIN_PX = 896;

/**
 * A list and the detail of its open subject. From 896px of its own width both are on screen (the list 360px, 400px from 1440,
 * then the detail); narrower, one at a time, chosen by `showDetail` and switched by a container query, never by a width
 * branch in the render (`state-and-data.md` rule 11). Children may use the same `@4xl:` / `@max-4xl:` variants. Consumers: Drafts and Activity.
 */
export function ListDetail({ list, detail, showDetail, listLabel, detailLabel, wide = false }: { list: ReactNode; detail: ReactNode; showDetail: boolean; listLabel: string; detailLabel: string; /** The list is the subject (Activity's table): two thirds of the width. */ wide?: boolean }) {
  return (
    <div className="@container flex min-h-0 min-w-0 flex-1" data-slot="list-detail">
      <div className={cn("flex min-h-0 min-w-0 flex-1 @4xl:grid", wide ? "@4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "@4xl:grid-cols-[var(--list-width)_minmax(0,1fr)]")}>
        <section aria-label={listLabel} className={cn("flex min-h-0 min-w-0 flex-1 flex-col @4xl:border-e", showDetail && "@max-4xl:hidden")}>
          {list}
        </section>
        <section aria-label={detailLabel} className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !showDetail && "@max-4xl:hidden")}>
          {detail}
        </section>
      </div>
    </div>
  );
}
