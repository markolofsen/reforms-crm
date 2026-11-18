"use client";

import { SquareTerminalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { SideDock } from "@hub/ui/product/side-dock";
import { useMediaQuery } from "@hub/ui/use-media-query";
import { HostPortal, HostSlot } from "./host";
import { SessionPane } from "./session";
import { TerminalHeader } from "./tabs";
import { TerminalContext, useTerminal, useTerminalModel } from "./use-terminal";

// The embedded terminal (P49): the shell frame mounts `TerminalProvider` around the shell, `TerminalDock` in its dock slot and
// `TerminalToggle` in the sidebar footer and the phone's top line. With `terminal.enabled` off (the state says `enabled: false`) none of
// them renders anything and the chord is not registered.

export function TerminalProvider({ project, children }: { project: string | null; children: ReactNode }) {
  return <TerminalContext value={useTerminalModel(project)}>{children}</TerminalContext>;
}

/** Whether the column is docked beside the screen now (the shell folds the sidebar to its rail beside it below 1600px). */
export function useTerminalDocked(): boolean {
  const { open } = useTerminal();
  return useMediaQuery("lg") && open;
}

/** Shows or hides the terminal (Ctrl+` does the same from anywhere). Focus comes back here when the terminal hides. */
export function TerminalToggle({ className }: { className?: string }) {
  const t = useTerminal();
  if (!t.state) return null;
  return (
    <ActionButton aria-keyshortcuts="Control+`" aria-label="Terminal" aria-pressed={t.open} className={className} data-terminal-toggle="" icon onClick={() => t.setOpen(!t.open)} size="s" variant="quiet">
      <SquareTerminalIcon aria-hidden="true" />
    </ActionButton>
  );
}

function Sessions() {
  const t = useTerminal();
  return (t.state?.sessions ?? []).map((s) => <SessionPane active={s.id === t.active} key={s.id} session={s} />);
}

/** The column's body when no session runs: starting one, or how to start one. */
function Empty() {
  const t = useTerminal();
  if ((t.state?.sessions.length ?? 0) > 0) return null;
  return <p className="measure p-4 text-muted-foreground text-sm">{t.creating ? "Starting..." : "No terminal is running. Start one with +."}</p>;
}

/**
 * The column itself. From 1024px a docked column beside the screen (`SideDock`: full height, resizable); narrower, a
 * full-screen layer over it (header "Terminal", the tabs, +, Hide). Closed, the sessions wait in a hidden holder. The
 * sessions render once into the one host node (`host.tsx`), which moves between these three places.
 */
export function TerminalDock() {
  const t = useTerminal();
  const wide = useMediaQuery("lg");
  if (!t.state) return null;
  return (
    <>
      {t.mounted && (
        <HostPortal>
          <Sessions />
        </HostPortal>
      )}
      {t.open && wide ? (
        <SideDock label="Terminal" onWidth={t.setWidth} width={t.width}>
          <TerminalHeader layer={false} />
          <Empty />
          <HostSlot />
        </SideDock>
      ) : t.open ? (
        <section aria-label="Terminal" className="fixed inset-0 z-30 flex flex-col bg-background" data-testid="terminal-layer">
          <TerminalHeader layer />
          <Empty />
          <HostSlot />
        </section>
      ) : (
        t.mounted && (
          <div hidden>
            <HostSlot />
          </div>
        )
      )}
    </>
  );
}
