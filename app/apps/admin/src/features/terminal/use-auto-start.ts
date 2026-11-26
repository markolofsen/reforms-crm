"use client";

import { useEffect, useRef } from "react";
import type { TerminalSessionDto } from "@hub/contract/terminal";

/** The session the column shows for this address: one of its project (running first), else any (P57 2e). */
export function sessionFor(list: readonly TerminalSessionDto[], project: string | null): TerminalSessionDto | null {
  const own = list.filter((s) => s.project === project);
  return own.find((s) => s.state === "running") ?? own[0] ?? (project ? null : (list[0] ?? null));
}

/**
 * The project the terminal follows, or `undefined` while the shell does not know it yet (the projects list is loading, or the
 * address is on its way to its canonical form). v0.12.9 live bug: a column restored open after a restart read the terminal
 * state before the projects, so the automatic start ran with no project and the server rightly picked Shell; now it waits.
 * With two or more projects, Overview and Connections have none (`scoped` is null there): Shell is right.
 */
export function terminalProjectOf(o: { loaded: boolean; pending: boolean; project: string | null; multi: boolean; scoped: string | null }): string | null | undefined {
  if (!o.loaded || o.pending) return undefined;
  return o.multi ? o.scoped : o.project;
}

type AutoStart = {
  open: boolean;
  /** State was read, no terminal problem, and the address's project is known. */
  ready: boolean;
  project: string | null;
  remembered: string | null;
  /** The last lost PTY id: a new recovery opportunity, not a crashed CLI retry. */
  recovery: string | null;
  fresh: () => Promise<readonly TerminalSessionDto[]>;
  ensure: () => void;
  show: (session: TerminalSessionDto) => void;
};

/** Re-read before choosing; one ensure attempt per project and lost-PTY event, including after the first start. */
export async function startVisibleSession(o: AutoStart, attempts: Map<string | null, string | null>, allowed: () => boolean): Promise<void> {
  if (!o.open || !o.ready || !allowed()) return;
  const list = await o.fresh();
  if (!allowed()) return;
  const kept = list.find((s) => s.id === o.remembered && (!o.project || s.project === o.project));
  const session = kept ?? sessionFor(list, o.project);
  if (session) return o.show(session);
  if (attempts.has(o.project) && attempts.get(o.project) === o.recovery) return;
  attempts.set(o.project, o.recovery);
  o.ensure();
}

/** An open, visible dock reconnects after PTY loss; a hidden page and a deliberately closed dock start nothing. */
export function useAutoStart(o: AutoStart) {
  const latest = useRef(o);
  useEffect(() => { latest.current = o; });
  const attempts = useRef(new Map<string | null, string | null>());
  const { open, ready, project, recovery } = o;
  useEffect(() => {
    if (!open || !ready) return;
    let gone = false;
    const allowed = () => !gone && latest.current.open && document.visibilityState === "visible";
    const run = () => startVisibleSession(latest.current, attempts.current, allowed);
    // Keep listening: a read that finishes while hidden is cancelled, then retried when visible again.
    const onShow = () => { if (allowed()) void run(); };
    document.addEventListener("visibilitychange", onShow);
    if (allowed()) void run();
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [open, ready, project, recovery]);
}
