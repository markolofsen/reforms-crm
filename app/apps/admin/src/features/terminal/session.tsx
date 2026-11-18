"use client";

import { useEffect, useRef, useState } from "react";
import type { TerminalSessionDto } from "@hub/contract/terminal";
import { cn } from "@hub/ui/cn";
import { ActionButton } from "@hub/ui/product/action-button";
import { TerminalView, type TerminalHandle, type TerminalSize } from "@hub/ui/product/terminal";
import { useResolvedTheme } from "@hub/ui/product/theme";
import { openWebLink } from "@/lib/external";
import { connectTerminal, type Link, type LinkState } from "./socket";
import { useTerminal } from "./use-terminal";

export const panelId = (id: string) => `terminal-panel-${id}`;
export const tabId = (id: string) => `terminal-tab-${id}`;

/** The one line under the screen when the session is not simply running and connected: what happened, and the one way on. */
function SessionLine({ session, link, onTakeBack }: { session: TerminalSessionDto; link: LinkState; onTakeBack: () => void }) {
  const { close, closing } = useTerminal();
  const line =
    session.state === "exited"
      ? { text: `The program ended${session.exitCode === null ? "" : ` with exit code ${session.exitCode}`}.`, action: <ActionButton disabled={closing === session.id} onClick={() => close(session.id)} size="s" variant="secondary">Close tab</ActionButton> }
      : link.kind === "taken"
        ? { text: "Opened in another window.", action: <ActionButton onClick={onTakeBack} size="s" variant="secondary">Take back</ActionButton> }
        : link.kind === "retrying"
          ? { text: `Connection lost. Trying again in ${Math.round(link.inMs / 1000)} s.`, action: null }
          : link.kind === "gone"
            ? { text: "This terminal has ended.", action: null }
            : null;
  return (
    <div className={cn("flex min-h-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm", line && "border-t px-3 py-2")} role="status">
      {line && <span className="min-w-0 flex-1">{line.text}</span>}
      {line?.action}
    </div>
  );
}

/**
 * One session: its terminal and its link. The link opens once the terminal exists (so no byte arrives before there is a
 * screen to write it on) and closes with the pane; the snapshot after every connect replaces the screen. Inactive panes stay
 * mounted, hidden, so their output keeps arriving.
 */
export function SessionPane({ session, active }: { session: TerminalSessionDto; active: boolean }) {
  const { register, patch } = useTerminal();
  const theme = useResolvedTheme();
  const link = useRef<Link | null>(null);
  const size = useRef<TerminalSize | null>(null);
  const [state, setState] = useState<LinkState>({ kind: "connecting" });
  const id = session.id;
  useEffect(
    () => () => {
      link.current?.close();
      link.current = null;
      register(id, null);
    },
    [id, register],
  );
  const onReady = (screen: TerminalHandle) => {
    register(id, screen);
    const l = connectTerminal(id, {
      output: (bytes, snapshot) => {
        if (snapshot) screen.reset();
        screen.write(bytes);
      },
      exit: (code) => patch(id, { state: "exited", exitCode: code }),
      state: (s) => {
        setState(s);
        if (s.kind === "gone") patch(id, null);
      },
    });
    link.current = l;
    if (size.current) l.resize(size.current.cols, size.current.rows);
  };
  return (
    <div aria-labelledby={tabId(id)} className={cn("min-h-0 min-w-0 flex-1 flex-col", active ? "flex" : "hidden")} id={panelId(id)} role="tabpanel">
      <TerminalView
        onInput={(bytes) => link.current?.input(bytes)}
        onLink={(uri) => void openWebLink(uri)}
        onReady={onReady}
        onSize={(s) => {
          size.current = s;
          link.current?.resize(s.cols, s.rows);
        }}
        resolvedTheme={theme}
      />
      <SessionLine link={state} onTakeBack={() => link.current?.takeBack()} session={session} />
    </div>
  );
}
