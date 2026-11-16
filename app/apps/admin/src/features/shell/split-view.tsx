import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The list column and the detail pane. From 800px up both are on screen (list 360px, 340px below 1280, then the pane);
 * below that one screen at a time: the list, or the detail when a subject is open (the Back control returns).
 */
export function SplitView({ list, detail, mobile, showDetail, listLabel, detailLabel }: { list: ReactNode; detail: ReactNode; mobile: boolean; showDetail: boolean; listLabel: string; detailLabel: string }) {
  if (mobile) {
    return showDetail ? (
      <section aria-label={detailLabel} className="flex min-h-0 flex-1 flex-col">
        {detail}
      </section>
    ) : (
      <section aria-label={listLabel} className="flex min-h-0 flex-1 flex-col">
        {list}
      </section>
    );
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[var(--list-width)_minmax(0,1fr)]">
      <section aria-label={listLabel} className="flex min-h-0 min-w-0 flex-col border-e">
        {list}
      </section>
      <section aria-label={detailLabel} className="flex min-h-0 min-w-0 flex-col">
        {detail}
      </section>
    </div>
  );
}

/** One scrolling pane for a section that is a single column (Bulk, Activity, Project). */
export function PaneScroll({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6", className)}>{children}</div>
    </div>
  );
}
