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

// The embedded terminal (P49): the shell frame mounts `TerminalProvider` around the shell and `TerminalDock` in its dock slot; the
// phone's top line carries `TerminalToggle`. Collapsed, the dock is a thin strip on the right edge from 640px (`md`; always there, full
// height); below 640px the strip would take a column from a 360px screen, so the phone's top line holds the one button instead.
// With `terminal.enabled` off (the state says `enabled: false`) none of them renders anything and the chord is not registered.

export function TerminalProvider({ project, children }: { project: string | null; children: ReactNode }) {
  return <TerminalContext value={useTerminalModel(project)}>{children}</TerminalContext>;
}

/** Whether the column is docked beside the screen now (the shell folds the sidebar to its rail beside it below 1600px). */
export function useTerminalDocked(): boolean {
  const { open } = useTerminal();
  return useMediaQuery("lg") && open;
}

/** The phone's button (below 640px): shows or hides the terminal (Ctrl+` does the same from anywhere). Focus comes back here when the terminal hides. */
export function TerminalToggle({ className }: { className?: string }) {
  const t = useTerminal();
  if (!t.state) return null;
  return (
    <ActionButton aria-keyshortcuts="Control+`" aria-label="Terminal" aria-pressed={t.open} className={className} data-terminal-toggle="" icon onClick={() => t.setOpen(!t.open)} size="s" variant="quiet">
      <SquareTerminalIcon aria-hidden="true" />
    </ActionButton>
  );
}

/** What the collapsed strip says: the open tab's program, else "Terminal". */
const STRIP_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex", shell: "Shell" };

/**
 * The collapsed dock from 640px: a 44px strip on the right edge, full height, always there while the terminal is on. One
 * button: the icon, the open tab's program written vertically, and a dot while a session runs. It opens the column (Ctrl+`
 * too); collapsing the column brings it back and focus returns to it. The sessions keep running.
 */
function TerminalStrip() {
  const t = useTerminal();
  const sessions = t.state?.sessions ?? [];
  const current = sessions.find((s) => s.id === t.active);
  const running = sessions.some((s) => s.state === "running");
  const label = current ? (STRIP_LABEL[current.preset] ?? "Terminal") : "Terminal";
  return (
    <div className="flex h-svh w-11 shrink-0 flex-col border-s bg-sidebar max-md:hidden" data-slot="terminal-strip">
      <ActionButton
        aria-describedby="terminal-strip-state"
        aria-expanded={false}
        aria-keyshortcuts="Control+`"
        // The name holds the visible label (WCAG 2.5.3, label in name): "Terminal", or "Terminal, Claude Code".
        aria-label={label === "Terminal" ? "Terminal" : `Terminal, ${label}`}
        className="h-auto min-h-0 w-full flex-1 flex-col justify-start gap-3 rounded-none border-0 py-3 text-muted-foreground sm:h-auto"
        data-terminal-toggle=""
        onClick={() => t.setOpen(true)}
        title="Open the terminal (Ctrl+`)"
        variant="quiet"
      >
        <SquareTerminalIcon aria-hidden="true" className="size-4 shrink-0" />
        <span aria-hidden="true" className="text-sm [writing-mode:vertical-rl]">{label}</span>
        {running && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success" data-testid="terminal-strip-dot" />}
      </ActionButton>
      <span className="sr-only" id="terminal-strip-state">{running ? `${label}, running` : "No terminal is running"}</span>
    </div>
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
        <>
          <TerminalStrip />
          {t.mounted && (
            <div hidden>
              <HostSlot />
            </div>
          )}
        </>
      )}
    </>
  );
}
