"use client";

import { useEffect, useRef } from "react";
import type { TerminalSessionDto } from "@hub/contract/terminal";

/** The session the column shows for this address: one of its project (running first), else any (P57 2e). */
export function sessionFor(list: readonly TerminalSessionDto[], project: string | null): TerminalSessionDto | null {
  const own = list.filter((s) => s.project === project);
  return own.find((s) => s.state === "running") ?? own[0] ?? (project ? null : (list[0] ?? null));
}

/**
 * The column starts its session by itself (P57 2a, 2e, 2g, 2h): each time it becomes visible (the strip, Ctrl+`, the phone's
 * button, or a column restored open from storage) the list is read fresh; a session of the address's project gets the focus,
 * else the server's pick starts (`ensure`), at most once per project per page load. A hidden page waits until it is shown, so a
 * background tab restored open starts nothing. A collapsed strip on page load starts nothing: `open` is false.
 */
export function useAutoStart(o: {
  open: boolean;
  /** The terminal is on and its state was read. */
  ready: boolean;
  project: string | null;
  /** The list, read fresh (`staleTime: 0`); the cached one when the read fails. */
  fresh: () => Promise<readonly TerminalSessionDto[]>;
  ensure: () => void;
  show: (session: TerminalSessionDto) => void;
}) {
  const latest = useRef(o);
  // Runs before the effect below (effects run in order), so `run` reads this render's project and callbacks.
  useEffect(() => {
    latest.current = o;
  });
  const started = useRef(new Set<string>());
  const { open, ready } = o;
  useEffect(() => {
    if (!open || !ready) return;
    let gone = false;
    const run = async () => {
      const { project, fresh, ensure, show } = latest.current;
      const list = await fresh();
      if (gone || !latest.current.open) return;
      const s = sessionFor(list, project);
      if (s) return show(s);
      const key = project ?? "";
      if (started.current.has(key)) return;
      started.current.add(key);
      ensure();
    };
    if (document.visibilityState === "visible") {
      void run();
      return () => { gone = true; };
    }
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onShow);
      void run();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [open, ready]);
}
