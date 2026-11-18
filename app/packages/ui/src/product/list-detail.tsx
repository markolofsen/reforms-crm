import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * A list and the detail of its open subject. From 1024px both are on screen (the list 360px, 400px from 1440, then the
 * detail); below 1024px one at a time, chosen by `showDetail` and switched by CSS, never by a width branch in the render
 * (`state-and-data.md` rule 11). Consumers: Drafts and Activity.
 */
export function ListDetail({ list, detail, showDetail, listLabel, detailLabel, wide = false }: { list: ReactNode; detail: ReactNode; showDetail: boolean; listLabel: string; detailLabel: string; /** The list is the subject (Activity's table): two thirds of the width. */ wide?: boolean }) {
  return (
    <div className={cn("flex min-h-0 flex-1 lg:grid", wide ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "lg:grid-cols-[var(--list-width)_minmax(0,1fr)]")} data-slot="list-detail">
      <section aria-label={listLabel} className={cn("flex min-h-0 min-w-0 flex-1 flex-col lg:border-e", showDetail && "max-lg:hidden")}>
        {list}
      </section>
      <section aria-label={detailLabel} className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !showDetail && "max-lg:hidden")}>
        {detail}
      </section>
    </div>
  );
}
