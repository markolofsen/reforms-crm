import type { ReactNode } from "react";

/**
 * One section of the Connections page: a heading and its rows. Every kind of connection is one group (Mail, Notion,
 * Telegram), so another read-only section (Agent tools, P49: `agent-tools/`) is one more group in `connections-view.tsx`, nothing else.
 */
export function ConnectionGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`group-${id}`} className="flex flex-col gap-1">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide" id={`group-${id}`}>
        {title}
      </h3>
      {children}
    </section>
  );
}
