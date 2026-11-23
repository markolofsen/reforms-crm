"use client";

import { SquareTerminalIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@hub/ui/cn";
import { ActionButton } from "@hub/ui/product/action-button";
import { AgentPanelFrame } from "@hub/ui/product/agent-panel";
import { SideDock } from "@hub/ui/product/side-dock";
import { TerminalDictationButton, type TerminalHandle } from "@hub/ui/product/terminal";
import { useMediaQuery } from "@hub/ui/use-media-query";
import { HostPortal, HostSlot } from "./host";
import { SessionPane } from "./session";
import { ProblemLine, TerminalHeader } from "./tabs";
import { TerminalContext, useTerminal, useTerminalModel } from "./use-terminal";

// The embedded terminal (P49): the shell frame mounts `TerminalProvider` around the shell and `TerminalDock` in its dock slot; the
// phone's top line carries `TerminalToggle`. Collapsed, the dock is a thin strip on the right edge from 640px (`md`; always there, full
// height); below 640px the strip would take a column from a 360px screen, so the phone's top line holds the one button instead.
// Always on (decision 0032): the strip, the column and the chord are always there in the browser, including while the first
// state read loads. When no tab can start (P66, the state's `problem`), the column says why and the one line that fixes it;
// nothing hides. None of it is in the server HTML (P49, `state-and-data.md` rule 11): the strip and the phone's button draw an
// empty box of their size until mounted, so nothing jumps, and a terminal saved open is restored after mount.

const noop = () => () => {};
/** False on the server and in the first render, true after mount (the theme switcher's pattern in `@hub/ui/product/theme`). */
const useMounted = (): boolean => useSyncExternalStore(noop, () => true, () => false);

/** `project` is `undefined` while the shell does not know it yet (the automatic start waits). */
export function TerminalProvider({ project, children }: { project: string | null | undefined; children: ReactNode }) {
  return <TerminalContext value={useTerminalModel(project)}>{children}</TerminalContext>;
}

/** Whether the column is docked beside the screen now (the shell folds the sidebar to its rail beside it below 1600px). */
export function useTerminalDocked(): boolean {
  const { open } = useTerminal();
  return useMediaQuery("lg") && open;
}

/** The phone button's name while the agent waits on him (P59; the strip adds the same words to its own): colour is not the only carrier (`accessibility.md` rule 6). */
const NEEDS_YOU = "Terminal, the agent needs you";

/**
 * The phone's button (below 640px): shows or hides the terminal (Ctrl+` and Meta/Ctrl+J do the same from anywhere). Focus comes back here when
 * the terminal hides. `attention` (P59): the agent waits on him, so the button carries the attention dot.
 */
export function TerminalToggle({ className, attention = false }: { className?: string; attention?: boolean }) {
  const t = useTerminal();
  const mounted = useMounted();
  // Before mount, a box of the button's size (control-s, 44px below 1024px) and no name: never in the server HTML.
  if (!mounted) return <span aria-hidden="true" className={cn("inline-block size-(--control-s) shrink-0", className)} />;
  return (
    <ActionButton aria-keyshortcuts="Meta+J Control+J" aria-label={attention ? NEEDS_YOU : "Terminal"} aria-pressed={t.open} className={cn("relative", className)} data-terminal-toggle="" icon onClick={() => t.setOpen(!t.open)} size="s" tooltip={{ content: "Show or hide terminal", hotkey: "Meta/Ctrl + J" }} variant="quiet">
      <SquareTerminalIcon aria-hidden="true" />
      {attention && <span aria-hidden="true" className="absolute end-1.5 top-1.5 size-2 rounded-full bg-warning" data-testid="terminal-toggle-dot" />}
    </ActionButton>
  );
}

/** What the collapsed strip says: the open tab's program, else "Terminal". */
const STRIP_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex", shell: "Shell" };

/**
 * The collapsed dock from 640px: a 44px strip on the right edge, full height, always there while the terminal is on. One
 * button: the icon, the open tab's program written vertically, and a dot while a session runs or while the agent waits on
 * him (P59: the attention colour then, also for a session that is not in the dock). It opens the column (Ctrl+` too);
 * collapsing the column brings it back and focus returns to it. The sessions keep running.
 */
function TerminalStrip({ attention }: { attention: boolean }) {
  const t = useTerminal();
  const mounted = useMounted();
  const sessions = t.state?.sessions ?? [];
  const current = sessions.find((s) => s.id === t.active);
  const running = sessions.some((s) => s.state === "running");
  const label = current ? (STRIP_LABEL[current.preset] ?? "Terminal") : "Terminal";
  const base = label === "Terminal" ? "Terminal" : `Terminal, ${label}`;
  const name = attention ? `${base}, the agent needs you` : base;
  // Before mount, the same 44px column, empty: the screen beside it keeps its width and the server HTML names no terminal.
  if (!mounted) return <div aria-hidden="true" className="h-svh w-11 shrink-0 border-s bg-sidebar max-md:hidden" data-slot="terminal-strip" />;
  return (
    <div className="flex h-svh w-11 shrink-0 flex-col border-s bg-sidebar max-md:hidden" data-slot="terminal-strip">
      <ActionButton
        aria-describedby="terminal-strip-state"
        aria-expanded={false}
        aria-keyshortcuts="Meta+J Control+J"
        // The name holds the visible label (WCAG 2.5.3, label in name): "Terminal", or "Terminal, Claude Code".
        aria-label={name}
        className="h-auto min-h-0 w-full flex-1 flex-col justify-start gap-3 rounded-none border-0 py-3 text-muted-foreground sm:h-auto"
        data-terminal-toggle=""
        onClick={() => t.setOpen(true)}
        tooltip={{ content: "Open the terminal", hotkey: "Meta/Ctrl + J" }}
        variant="quiet"
      >
        <SquareTerminalIcon aria-hidden="true" className="size-4 shrink-0" />
        <span aria-hidden="true" className="text-sm [writing-mode:vertical-rl]">{label}</span>
        {attention ? (
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" data-attention="" data-testid="terminal-strip-dot" />
        ) : (
          running && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success" data-testid="terminal-strip-dot" />
        )}
      </ActionButton>
      <span className="sr-only" id="terminal-strip-state">{attention ? "The agent waits on you" : running ? `${label}, running` : "No terminal is running"}</span>
    </div>
  );
}

function Sessions({ onActiveScreen }: { onActiveScreen: (screen: TerminalHandle | null) => void }) {
  const t = useTerminal();
  return (t.state?.sessions ?? []).map((s) => <SessionPane active={s.id === t.active} key={s.id} onActiveScreen={onActiveScreen} session={s} />);
}

/** What is starting, as far as the admin can tell before the server answers: the first ready CLI here, else "a terminal". */
function startingWhat(t: { project: string | null; offered: readonly string[]; clis: readonly { cli: string; state: string }[] }): string {
  if (!t.project) return "Shell";
  const ready = t.offered.find((p) => t.clis.some((c) => c.cli === p && c.state === "ready"));
  return ready ? (STRIP_LABEL[ready] ?? "a terminal") : "a terminal";
}

/** The column's body when no session runs: why none can start (P66), starting one, or how to start one. */
function Empty() {
  const t = useTerminal();
  if ((t.state?.sessions.length ?? 0) > 0) return null;
  if (t.problem) return <ProblemLine problem={t.problem} />;
  return <p className="measure p-4 text-muted-foreground text-sm">{t.creating ? `Starting ${startingWhat(t)}...` : "No terminal is running. Start one with +."}</p>;
}

/** How long after the press the keys are held at the terminal: the closing menu hands focus back to its trigger in a later job. */
const HOLD_MS = 500;
const PANEL = '[data-slot="side-dock-panel"]';

const over = (el: Element | null, x: number, y: number): boolean => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

/**
 * P88 (research 27, B7): a page menu (a View menu, the client menu) is modal by default in Base UI, so while it is open a press
 * on the docked column lands on the menu's backdrop (`data-base-ui-inert`), not on the terminal: the menu closed, focus went
 * back to its trigger, and the words he typed next reopened the menu (Space) and went into it. A press on that backdrop over
 * the column now moves focus into the open tab's terminal, and holds it there for a moment while the menu closes; the menu then
 * closes on that focus-out and does not take focus back. One guard at the dock for every menu: no menu is edited.
 */
function useMenuHandoff(on: boolean, focusActive: () => void) {
  const latest = useRef(focusActive);
  useEffect(() => {
    latest.current = focusActive;
  });
  useEffect(() => {
    if (!on) return;
    let until = 0;
    let frame = 0;
    const panel = () => document.querySelector(PANEL);
    const hold = () => {
      frame = 0;
      if (performance.now() > until) return;
      const p = panel();
      if (p && !p.contains(document.activeElement)) latest.current();
      frame = requestAnimationFrame(hold);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.closest("[data-base-ui-inert]") || !over(panel(), e.clientX, e.clientY)) return;
      until = performance.now() + HOLD_MS;
      latest.current();
      if (!frame) frame = requestAnimationFrame(hold);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      cancelAnimationFrame(frame);
    };
  }, [on]);
}

/**
 * The column itself. From 1024px a docked column beside the screen (`SideDock`: full height, resizable); narrower, a
 * full-screen layer over it (header "Terminal", the tabs, +, Hide). Closed, the sessions wait in a hidden holder. The
 * sessions render once into the one host node (`host.tsx`), which moves between these three places.
 */
export function TerminalDock({ attention = false, onSeen }: { attention?: boolean; onSeen?: () => void }) {
  const t = useTerminal();
  const wide = useMediaQuery("lg");
  const activeSession = t.active !== null && (t.state?.sessions.some((session) => session.id === t.active) ?? false);
  const activeScreen = useRef<TerminalHandle | null>(null);
  const onActiveScreen = useCallback((screen: TerminalHandle | null) => {
    activeScreen.current = screen;
  }, []);
  useMenuHandoff(t.open && wide, t.focusActive);
  // Opening the column is seeing the wait (P59): the dot goes back to the session colour until the agent waits again.
  useEffect(() => {
    if (t.open && attention) onSeen?.();
  }, [t.open, attention, onSeen]);
  return (
    <>
      {t.mounted && (
        <HostPortal>
          <Sessions onActiveScreen={onActiveScreen} />
        </HostPortal>
      )}
      {t.open && wide ? (
        <SideDock label="Terminal" onWidth={t.setWidth} width={t.width}>
          <AgentPanelFrame footer={activeSession ? <TerminalDictationButton screen={activeScreen} /> : undefined} header={<TerminalHeader layer={false} />}>
            <Empty />
            <HostSlot />
          </AgentPanelFrame>
        </SideDock>
      ) : t.open ? (
        <section aria-label="Terminal" className="fixed inset-0 z-30 flex flex-col bg-background" data-testid="terminal-layer">
          <AgentPanelFrame footer={activeSession ? <TerminalDictationButton screen={activeScreen} /> : undefined} header={<TerminalHeader layer />}>
            <Empty />
            <HostSlot />
          </AgentPanelFrame>
        </section>
      ) : (
        <>
          <TerminalStrip attention={attention} />
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
