import type { ReactNode } from "react";

/**
 * One group of a Settings pane (P70): a small heading and its rows (Notion and Telegram on Connections, Accounts and Filters on
 * Mail, a CLI on Agent, This Mac's two). Another group is one more `SettingsGroup` in its pane, nothing else.
 */
export function SettingsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`group-${id}`} className="flex flex-col gap-1">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide" id={`group-${id}`}>
        {title}
      </h3>
      {children}
    </section>
  );
}
