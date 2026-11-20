"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FOCUS_HEARTBEAT_MS, type FocusPost } from "@hub/contract/focus";
import { useRoute } from "@/hooks/use-route";
import { focusApi } from "@/lib/api/terminal";
import { sharePublished, useSharedFocus } from "@/lib/focus";
import { deriveFocus, sameFocus } from "./derive";
import { useMainObservers } from "./use-main-observers";

/** A change settles for this long before it is posted (typing in the search box, arrowing through rows). */
export const FOCUS_DEBOUNCE_MS = 300;

const visibleNow = (): boolean => document.visibilityState === "visible";

// A random id per page load, made on the client only: the server snapshot is null, so the first render reads no browser API.
let tabId: string | null = null;
const tabOf = (): string => (tabId ??= crypto.randomUUID().replace(/-/g, "").slice(0, 16));
const noSubscribe = () => () => {};
const useTabId = (): string | null => useSyncExternalStore(noSubscribe, tabOf, () => null);

/**
 * The shell frame's publisher (P51, decision 0029; P72, decision 0038): this tab's focus (the route, its title and refs:
 * `derive.ts`) goes to `POST /api/focus` after it settles, again when
 * the window gets focus or becomes visible (the last focused tab wins), every 60 s while visible (fresh means at most 10
 * minutes old), and is cleared on `pagehide`. A failed post is dropped: the next change or heartbeat sends it again.
 */
export function useFocusPublisher(project: string | null): void {
  const route = useRoute();
  const shared = useSharedFocus();
  const tab = useTabId();
  const [visible, setVisible] = useState(true);
  const [beat, setBeat] = useState(0);
  const last = useRef<FocusPost | null>(null);
  // The row he is on and the rows on screen, from `#main` (cleared when the address moves to another screen).
  useMainObservers(`${route.route} ${project ?? ""}`);

  useEffect(() => {
    if (!tab) return;
    const wake = () => {
      setVisible(visibleNow());
      last.current = null; // re-post even when unchanged: this tab is in front now
      setBeat((n) => n + 1);
    };
    const leave = () => focusApi.clear(tab);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pagehide", leave);
    const heartbeat = window.setInterval(() => {
      if (visibleNow()) {
        last.current = null;
        setBeat((n) => n + 1);
      }
    }, FOCUS_HEARTBEAT_MS);
    return () => {
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pagehide", leave);
      window.clearInterval(heartbeat);
    };
  }, [tab]);

  useEffect(() => {
    if (!tab) return;
    const parts = { subject: shared.subject?.ref ?? null, pointed: shared.pointed?.ref ?? null, selected: shared.selected, window: shared.window, pointer: shared.pointer };
    const next = deriveFocus({ tab, route, project, parts, visible });
    if (sameFocus(next, last.current)) return;
    const t = window.setTimeout(() => {
      last.current = next;
      sharePublished(next);
      focusApi.post(next).catch(() => {
        last.current = null;
      });
    }, FOCUS_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [tab, route, project, shared.subject, shared.pointed, shared.selected, shared.window, shared.pointer, visible, beat]);
}
