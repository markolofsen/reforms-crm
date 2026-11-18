"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { TerminalPreset, TerminalSessionDto, TerminalStateDto } from "@hub/contract/terminal";
import { MAX_SESSIONS } from "@hub/contract/terminal";
import type { TerminalHandle } from "@hub/ui/product/terminal";
import { parseWidth } from "@hub/ui/product/side-dock";
import { useMediaQuery } from "@hub/ui/use-media-query";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { sentence } from "@/lib/api/client";
import { terminalApi } from "@/lib/api/terminal";
import { save, useStored } from "@/lib/storage";

export const TERMINAL_KEY = ["terminal"] as const;
const HELP = [["Ctrl `", "show or hide the terminal"]] as const;
const NO_HELP: readonly (readonly [string, string])[] = [];

/** Everything the toggle, the dock, the tabs and the sessions read and do. One instance, made by `TerminalProvider`. */
export type TerminalModel = {
  /** The instance's terminal: null while loading and when `terminal.enabled` is off (then nothing renders). */
  state: TerminalStateDto | null;
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
  full: boolean;
  setOpen: (open: boolean) => void;
  create: (preset: TerminalPreset) => void;
  creating: boolean;
  close: (id: string) => void;
  closing: string | null;
  /** The last failure, said in the column. */
  notice: string | null;
  /** A session's terminal is ready (focus may move into it) or gone. */
  register: (id: string, handle: TerminalHandle | null) => void;
  /** A session's own news (its program ended, or it is gone): the cached list follows. */
  patch: (id: string, change: Partial<TerminalSessionDto> | null) => void;
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

/** Focus moves into a session's terminal now, or as soon as it is ready. */
function useFocus() {
  const handles = useRef(new Map<string, TerminalHandle>());
  const wanted = useRef<string | null>(null);
  const focus = useCallback((id: string | null) => {
    const h = id ? handles.current.get(id) : undefined;
    wanted.current = h ? null : id;
    if (h) requestAnimationFrame(() => h.focus());
  }, []);
  const register = useCallback((id: string, handle: TerminalHandle | null) => {
    if (!handle) return void handles.current.delete(id);
    handles.current.set(id, handle);
    if (wanted.current === id) {
      wanted.current = null;
      requestAnimationFrame(() => handle.focus());
    }
  }, []);
  return { focus, register };
}

/**
 * The terminal's state: the server's sessions (`GET /api/terminal`; `{enabled: false}` = off), and three viewing preferences in storage
 * (open, width, active tab; read after mount, so the first render is closed). A saved "open" is restored only from 1024px;
 * below that the person opens it. Ctrl+` toggles it from anywhere, the terminal included.
 */
export function useTerminalModel(project: string | null): TerminalModel {
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
  const active = sessions.find((s) => s.id === storedTab)?.id ?? sessions[0]?.id ?? null;
  const offered = state ? (project ? state.presets : state.presets.filter((p) => p === "shell")) : [];
  /** What plain opening starts in an empty column: the default here. */
  const preset = offered[0] ?? null;
  const full = sessions.length >= MAX_SESSIONS;
  const [notice, setNotice] = useState<string | null>(null);
  const { focus, register } = useFocus();

  const setList = useCallback((fn: (list: TerminalSessionDto[]) => TerminalSessionDto[]) => qc.setQueryData<TerminalStateDto | null>(TERMINAL_KEY, (old) => old && { ...old, sessions: fn(old.sessions) }), [qc]);
  const setActive = useCallback((id: string) => save("terminal-tab", id), []);
  const setOpenRaw = useCallback((next: boolean) => {
    setChosen(next);
    save("terminal", next ? "open" : "closed");
    if (!next) focusBack();
  }, []);

  const creating = useMutation({
    mutationFn: (preset: TerminalPreset) => terminalApi.create(project ? { preset, project } : { preset }),
    onMutate: () => setNotice(null),
    onSuccess: (s) => {
      setList((list) => [...list.filter((x) => x.id !== s.id), s]);
      setActive(s.id);
      focus(s.id);
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
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenRaw(next);
      if (!next) return;
      // Opening an empty column starts the default, as a terminal panel does; otherwise focus goes into the open tab. The list is
      // read fresh first: a session closed elsewhere (another window, the server restarted) must not leave an empty column.
      void qc.fetchQuery({ queryKey: TERMINAL_KEY, queryFn: terminalApi.state, staleTime: 0 }).then(
        (s) => {
          const list = s?.sessions ?? [];
          if (list.length === 0 && preset) create(preset);
          else focus(list.find((x) => x.id === active)?.id ?? list[0]?.id ?? null);
        },
        () => {
          if (sessions.length === 0 && preset) create(preset);
          else focus(active);
        },
      );
    },
    [setOpenRaw, qc, sessions.length, preset, create, focus, active],
  );
  useHotkeys(state ? { "ctrl+`": () => setOpen(!open) } : {}, true, state ? HELP : NO_HELP);

  const patch = useCallback(
    (id: string, change: Partial<TerminalSessionDto> | null) => {
      if (change) setList((list) => list.map((s) => (s.id === id ? { ...s, ...change } : s)));
      else void qc.invalidateQueries({ queryKey: TERMINAL_KEY });
    },
    [qc, setList],
  );

  return {
    state,
    project,
    open,
    mounted,
    width,
    setWidth: (w) => save("terminal-width", String(w)),
    active,
    setActive,
    offered,
    full,
    setOpen,
    create,
    creating: creating.isPending,
    close: closing.mutate,
    closing: closing.isPending ? (closing.variables ?? null) : null,
    notice,
    register,
    patch,
  };
}
