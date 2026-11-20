"use client";

import { useEffect } from "react";
import { FOCUS_WINDOW_MAX } from "@hub/contract/focus";
import { AGENT_REF_ATTR, sharePointed, shareWindow } from "@/lib/focus";

const ROW = `[${AGENT_REF_ATTR}]`;

/**
 * The words he reads on a row, for the dock header only (never posted): its `aria-label`, else the element marked
 * `data-agent-label` (the title cell), else its first cell, else its text. Cut to 120 characters.
 */
export function rowLabel(el: Element): string {
  const aria = el.getAttribute("aria-label")?.trim();
  const text = aria || ((el.querySelector("[data-agent-label]") ?? el.querySelector("td, th") ?? el).textContent ?? "");
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
}

/**
 * The two observers of `#main` (P72, decision 0038), scoped to the screen: nothing outside `#main` (the dock, the sidebar) is
 * a page. `pointed`: the last row (`[data-agent-ref]`) that got keyboard focus or a pointer press, never hover, kept until
 * another row takes it or the screen changes (`screenKey`). `window`: the rows intersecting the viewport, in document order,
 * at most 30 refs, and how many distinct rows the list has. Attached in an effect only (the first render reads no DOM).
 */
export function useMainObservers(screenKey: string): void {
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    sharePointed(null);
    const point = (e: Event) => {
      const row = e.target instanceof Element ? e.target.closest(ROW) : null;
      const ref = row && main.contains(row) ? row.getAttribute(AGENT_REF_ATTR) : null;
      if (row && ref) sharePointed({ ref, label: rowLabel(row) });
    };
    main.addEventListener("focusin", point);
    main.addEventListener("pointerdown", point);

    const shown = new Set<Element>();
    let frame = 0;
    const publish = () => {
      frame = 0;
      const rows = [...main.querySelectorAll(ROW)];
      const all = new Set(rows.map((el) => el.getAttribute(AGENT_REF_ATTR)));
      const refs: string[] = [];
      for (const el of rows) {
        const ref = el.getAttribute(AGENT_REF_ATTR);
        if (!ref || !shown.has(el) || refs.includes(ref)) continue;
        refs.push(ref);
        if (refs.length >= FOCUS_WINDOW_MAX) break;
      }
      shareWindow(all.size ? { refs, total: all.size } : null);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(publish);
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) shown.add(e.target);
        else shown.delete(e.target);
      }
      schedule();
    });
    const watch = () => {
      for (const el of main.querySelectorAll(ROW)) io.observe(el);
      for (const el of [...shown]) if (!el.isConnected) shown.delete(el);
      schedule();
    };
    const mo = new MutationObserver(watch);
    mo.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: [AGENT_REF_ATTR] });
    watch();
    return () => {
      main.removeEventListener("focusin", point);
      main.removeEventListener("pointerdown", point);
      mo.disconnect();
      io.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      sharePointed(null);
      shareWindow(null);
    };
  }, [screenKey]);
}
