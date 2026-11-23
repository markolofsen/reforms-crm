"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { DROP_LIMITS, type TerminalSessionDto } from "@hub/contract/terminal";
import { cn } from "@hub/ui/cn";
import { ActionButton } from "@hub/ui/product/action-button";
import { pasteLine, TerminalView, type Dropped, type TerminalHandle, type TerminalSize } from "@hub/ui/product/terminal";
import { useResolvedTheme } from "@hub/ui/product/shell/theme";
import { sentence } from "@/lib/api/client";
import { terminalApi } from "@/lib/api/terminal";
import { openLink, webLink } from "@/lib/external";
import { connectTerminal, type Link, type LinkState } from "./socket";
import { useTerminal } from "./use-terminal";

export const panelId = (id: string) => `terminal-panel-${id}`;
export const tabId = (id: string) => `terminal-tab-${id}`;

/** How long the outcome stays in the pane's status line. */
const NOTE_MS = 8_000;
const MB = 1024 * 1024;
const LIMIT_MIB = DROP_LIMITS.bytes / MB;
const size = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
export const FOLDER_REFUSED = "Folders are not taken: drop the files, or a zip of the folder.";

/** Why these files cannot go in one drop, said by the pane itself (a refusal past Next's buffer would not reach it as a sentence); null when they can. */
export function dropTooBig(files: ReadonlyArray<{ name: string; size: number }>): string | null {
  if (files.length > DROP_LIMITS.files) return `A drop takes at most ${DROP_LIMITS.files} files; this one has ${files.length}. Nothing was pasted.`;
  const big = files.find((f) => f.size > DROP_LIMITS.bytes);
  if (big) return `${big.name} is ${size(big.size)}; a drop takes ${LIMIT_MIB} MiB in all. Nothing was pasted.`;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > DROP_LIMITS.bytes) return `These ${files.length} files are ${size(total)} together; a drop takes ${LIMIT_MIB} MiB in all. Nothing was pasted.`;
  return null;
}

/**
 * P76, decision 0041: a drop on the session's terminal. Files are copied by the server under `state/drops/` and their paths
 * pasted (xterm's paste, through the session's own socket); text is pasted as is; a folder is refused. Nothing is sent: the
 * owner presses Enter. `note` is the outcome for the pane's status line.
 */
export function useDropPaste(session: string, screen: RefObject<TerminalHandle | null>) {
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const say = (text: string | null, keep = false) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNote(text);
    if (text && !keep) timer.current = setTimeout(() => setNote(null), NOTE_MS);
  };
  const paste = (text: string) => {
    screen.current?.paste(text);
    screen.current?.focus();
  };
  const onDrop = (d: Dropped) => {
    if (d.kind === "none") return;
    if (d.kind === "folder") return say(FOLDER_REFUSED);
    if (d.kind === "text") return paste(d.text);
    const refused = dropTooBig(d.files);
    if (refused) return say(refused);
    const count = `${d.files.length} file${d.files.length === 1 ? "" : "s"}`;
    say(`Copying ${count}…`, true);
    terminalApi.drop(session, d.files).then(
      (r) => {
        paste(pasteLine(r.paths));
        say(`${count} pasted.`);
      },
      (e: unknown) => say(`${sentence(e)} Nothing was pasted.`),
    );
  };
  return { note, onDrop };
}

/**
 * The one line under the screen when the session is not simply running and connected: what happened, and the one way on;
 * else the outcome of the last drop (P76), if any.
 */
function SessionLine({ session, link, note, onTakeBack }: { session: TerminalSessionDto; link: LinkState; note: string | null; onTakeBack: () => void }) {
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
            : note
              ? { text: note, action: null }
              : null;
  return (
    <div className={cn("flex min-h-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm", line && "border-t px-3 py-2")} data-slot="terminal-status" role="status">
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
export function SessionPane({ session, active, onActiveScreen }: { session: TerminalSessionDto; active: boolean; onActiveScreen?: (screen: TerminalHandle | null) => void }) {
  const { register, patch } = useTerminal();
  const theme = useResolvedTheme();
  const link = useRef<Link | null>(null);
  const size = useRef<TerminalSize | null>(null);
  const screenRef = useRef<TerminalHandle | null>(null);
  const [state, setState] = useState<LinkState>({ kind: "connecting" });
  const id = session.id;
  const drop = useDropPaste(id, screenRef);
  useEffect(
    () => () => {
      link.current?.close();
      link.current = null;
      screenRef.current = null;
      register(id, null);
    },
    [id, register],
  );
  useEffect(() => {
    if (!active) return;
    onActiveScreen?.(screenRef.current);
    return () => onActiveScreen?.(null);
  }, [active, onActiveScreen]);
  const onReady = (screen: TerminalHandle) => {
    register(id, screen);
    screenRef.current = screen;
    if (active) onActiveScreen?.(screen);
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
        onDrop={session.state === "running" ? drop.onDrop : undefined}
        onLink={(uri) => void openLink(webLink(uri))}
        onReady={onReady}
        onSize={(s) => {
          size.current = s;
          link.current?.resize(s.cols, s.rows);
        }}
        resolvedTheme={theme}
      />
      <SessionLine link={state} note={drop.note} onTakeBack={() => link.current?.takeBack()} session={session} />
    </div>
  );
}
