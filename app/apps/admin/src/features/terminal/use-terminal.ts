"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { CliFactDto, TerminalPreset, TerminalProblemDto, TerminalSessionDto, TerminalStateDto } from "@hub/contract/terminal";
import { MAX_SESSIONS } from "@hub/contract/terminal";
import type { TerminalHandle } from "@hub/ui/product/terminal";
import { parseWidth } from "@hub/ui/product/side-dock";
import { useMediaQuery } from "@hub/ui/use-media-query";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { sentence } from "@/lib/api/client";
import { terminalApi } from "@/lib/api/terminal";
import { save, useStored } from "@/lib/storage";
import { sessionFor, useAutoStart } from "./use-auto-start";

export const TERMINAL_KEY = ["terminal"] as const;
const HELP = [["Ctrl `", "show or hide the terminal"]] as const;

/** Everything the toggle, the dock, the tabs and the sessions read and do. One instance, made by `TerminalProvider`. */
export type TerminalModel = {
  /** The instance's terminal (always on, decision 0032): null only while the first read is loading. */
  state: TerminalStateDto | null;
  /** Why no tab can start on this Mac (P66), with its fix line; the column says it, nothing hides. null: a tab can start. */
  problem: TerminalProblemDto | null;
  /** The project of the address; null on Overview and Connections (only Shell is offered there). */
  project: string | null;
  open: boolean;
  /** The sessions are mounted (the terminal was opened once on this page); they stay mounted while the column is closed. */
  mounted: boolean;
  width: number;
  setWidth: (w: number) => void;
  active: string | null;
  setActive: (id: string) => void;
  /** The presets the `+` menu offers here, the default first. */
  offered: TerminalPreset[];
  /** What the server's detector found (P57): the `+` menu says a CLI's state; empty until the first detection finished. */
  clis: CliFactDto[];
  /** The one line when the automatic start was not the first choice ("Codex: Claude Code is not signed in · claude auth login"). */
  why: string | null;
  full: boolean;
  setOpen: (open: boolean) => void;
  create: (preset: TerminalPreset) => void;
  creating: boolean;
  close: (id: string) => void;
  closing: string | null;
  /** The last failure, said in the column. */
  notice: string | null;
  /** Focus moves into the open tab's terminal (P88: a press on a page menu's backdrop over the column hands the keys here). */
  focusActive: () => void;
  /** A session's terminal is ready (focus may move into it) or gone. */
  register: (id: string, handle: TerminalHandle | null) => void;
  /** A session's own news (its program ended, or it is gone): the cached list follows. */
  patch: (id: string, change: Partial<TerminalSessionDto> | null) => void;
  /**
   * P96 S2: puts a request into this project's agent session without Enter (Prepare reply): the column opens, the project's
   * running session is used or the server's pick starts (`ensure`), and the text is pasted (xterm's paste, the session's own
   * socket) with the focus moved there. The owner presses Enter: the server never types a command (`routes/terminal.ts`).
   */
  pasteToAgent: (text: string) => void;
};

export const TerminalContext = createContext<TerminalModel | null>(null);

export function useTerminal(): TerminalModel {
  const t = useContext(TerminalContext);
  if (!t) throw new Error("useTerminal: not inside TerminalProvider (the shell frame mounts it).");
  return t;
}

/** Focus goes back where the person came from: the visible toggle, else the main region. */
function focusBack() {
  requestAnimationFrame(() => {
    const toggle = [...document.querySelectorAll<HTMLElement>("[data-terminal-toggle]")].find((el) => el.getClientRects().length > 0);
    (toggle ?? document.getElementById("main"))?.focus();
  });
}

/** A new session's program (Claude Code, Codex) needs a moment before its prompt reads input: a paste into it waits this long. */
const FRESH_PASTE_MS = 3000;

/** Focus moves into a session's terminal now, or as soon as it is ready; so does a paste (P96 S2). */
function useFocus() {
  const handles = useRef(new Map<string, TerminalHandle>());
  const wanted = useRef<string | null>(null);
  const pending = useRef<{ id: string; text: string; delay: number } | null>(null);
  const deliver = (handle: TerminalHandle, text: string, delay: number) => {
    setTimeout(() => {
      handle.paste(text);
      handle.focus();
    }, delay);
  };
  const focus = useCallback((id: string | null) => {
    const h = id ? handles.current.get(id) : undefined;
    wanted.current = h ? null : id;
    if (h) requestAnimationFrame(() => h.focus());
  }, []);
  const paste = useCallback((id: string, text: string, fresh: boolean) => {
    const h = handles.current.get(id);
    if (h) return deliver(h, text, fresh ? FRESH_PASTE_MS : 0);
    pending.current = { id, text, delay: fresh ? FRESH_PASTE_MS : 300 };
  }, []);
  const register = useCallback((id: string, handle: TerminalHandle | null) => {
    if (!handle) return void handles.current.delete(id);
    handles.current.set(id, handle);
    if (wanted.current === id) {
      wanted.current = null;
      requestAnimationFrame(() => handle.focus());
    }
    const p = pending.current;
    if (p?.id === id) {
      pending.current = null;
      deliver(handle, p.text, p.delay);
    }
  }, []);
  return { focus, register, paste };
}

/**
 * The terminal's state: the server's sessions and `problem` (`GET /api/terminal`), and three viewing preferences in storage
 * (open, width, active tab; read after mount, so the first render is closed). A saved "open" is restored only from 1024px;
 * below that the person opens it. Ctrl+` toggles it from anywhere, the terminal included.
 */
export function useTerminalModel(place: string | null | undefined): TerminalModel {
  // `undefined`: the shell does not know the project yet; nothing starts by itself until it does.
  const known = place !== undefined;
  const project = place ?? null;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: TERMINAL_KEY, queryFn: terminalApi.state });
  const state = q.data ?? null;
  const wide = useMediaQuery("lg");
  const stored = useStored("terminal");
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = state !== null && (chosen ?? (stored === "open" && wide));
  const mounted = open || chosen !== null;
  const width = parseWidth(useStored("terminal-width"));
  const sessions = state?.sessions ?? [];
  const storedTab = useStored("terminal-tab");
  // The stored tab, unless it belongs to another project and this one has a session (P57 2e).
  const stored0 = sessions.find((s) => s.id === storedTab);
  const active = (stored0 && (!project || stored0.project === project) ? stored0 : (sessionFor(sessions, project) ?? stored0 ?? sessions[0]))?.id ?? null;
  const offered = state ? (project ? state.presets : state.presets.filter((p) => p === "shell")) : [];
  const full = sessions.length >= MAX_SESSIONS;
  const [notice, setNotice] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const { focus, register, paste } = useFocus();

  const setList = useCallback((fn: (list: TerminalSessionDto[]) => TerminalSessionDto[]) => qc.setQueryData<TerminalStateDto | null>(TERMINAL_KEY, (old) => old && { ...old, sessions: fn(old.sessions) }), [qc]);
  const setActive = useCallback((id: string) => save("terminal-tab", id), []);
  const setOpenRaw = useCallback((next: boolean) => {
    setChosen(next);
    save("terminal", next ? "open" : "closed");
    if (!next) focusBack();
  }, []);

  const shown = useCallback((s: TerminalSessionDto) => {
    setList((list) => [...list.filter((x) => x.id !== s.id), s]);
    setActive(s.id);
    focus(s.id);
  }, [setList, setActive, focus]);
  const creating = useMutation({
    mutationFn: (preset: TerminalPreset) => terminalApi.create(project ? { preset, project } : { preset }),
    onMutate: () => { setNotice(null); setWhy(null); },
    onSuccess: shown,
    onError: (e) => setNotice(`Could not start a terminal: ${sentence(e)}`),
  });
  /** The automatic start (P57): the server's pick, or its running session of this project. */
  const ensuring = useMutation({
    mutationFn: () => terminalApi.ensure(project ? { project } : {}),
    onMutate: () => setNotice(null),
    onSuccess: (r) => {
      shown(r.session);
      if (r.created) setWhy(r.why);
    },
    onError: (e) => setNotice(`Could not start a terminal: ${sentence(e)}`),
  });
  const closing = useMutation({
    mutationFn: (id: string) => terminalApi.close(id),
    onMutate: () => setNotice(null),
    onSuccess: (_ok, id) => {
      const rest = sessions.filter((s) => s.id !== id);
      setList((list) => list.filter((s) => s.id !== id));
      if (rest.length === 0) setOpenRaw(false);
      else if (id === active) {
        const next = rest[0]?.id ?? null;
        if (next) setActive(next);
        focus(next);
      }
    },
    onError: (e) => setNotice(`Could not close the terminal: ${sentence(e)}`),
  });

  const create = creating.mutate;
  const pasteToAgent = (text: string) => {
    if (!project) return setNotice("Open a project first: the request goes to that project's agent.");
    setOpenRaw(true);
    const running = sessions.find((s) => s.project === project && s.state === "running");
    if (running) {
      setActive(running.id);
      return paste(running.id, text, false);
    }
    ensuring.mutateAsync().then(
      (r) => paste(r.session.id, text, r.created),
      () => undefined, // `ensuring` says why in the column
    );
  };
  // Each time the column becomes visible the list is read fresh (a session closed elsewhere, or a restarted server, must not
  // leave an empty column): this project's session gets the focus, else the server starts its pick, once per page load.
  useAutoStart({
    open,
    // P66: with a problem nothing starts by itself; the column says why instead.
    ready: state !== null && state.problem === null && known,
    project,
    remembered: storedTab,
    fresh: () => qc.fetchQuery({ queryKey: TERMINAL_KEY, queryFn: terminalApi.state, staleTime: 0 }).then((s) => s.sessions, () => sessions),
    ensure: () => ensuring.mutate(),
    show: (s) => {
      setActive(s.id);
      focus(s.id);
    },
  });
  const setOpen = setOpenRaw;
  useHotkeys({ "ctrl+`": () => setOpen(!open) }, true, HELP);

  const patch = useCallback(
    (id: string, change: Partial<TerminalSessionDto> | null) => {
      if (change) setList((list) => list.map((s) => (s.id === id ? { ...s, ...change } : s)));
      else void qc.invalidateQueries({ queryKey: TERMINAL_KEY });
    },
    [qc, setList],
  );

  return {
    state,
    problem: state?.problem ?? null,
    project,
    open,
    mounted,
    width,
    setWidth: (w) => save("terminal-width", String(w)),
    active,
    setActive,
    offered,
    clis: state?.clis ?? [],
    why,
    full,
    setOpen,
    create,
    creating: creating.isPending || ensuring.isPending,
    close: closing.mutate,
    closing: closing.isPending ? (closing.variables ?? null) : null,
    notice,
    focusActive: () => focus(active),
    register,
    patch,
    pasteToAgent,
  };
}
