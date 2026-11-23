import type { ReactNode } from "react";
import { SectionTitle } from "@hub/ui/product/shell/page";

/**
 * One group of a Settings pane (P70): its heading (`SectionTitle`, one style everywhere) and its rows (Accounts on Mail). Another
 * group is one more `SettingsGroup` in its pane; a group of one row whose label says it needs no heading (UX pass 2026-11-20).
 */
export function SettingsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`group-${id}`} className="flex flex-col gap-1">
      <SectionTitle id={`group-${id}`}>{title}</SectionTitle>
      {children}
    </section>
  );
}
