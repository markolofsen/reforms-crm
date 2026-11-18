"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

// One mounted host for every terminal of the page (the django-cfg AssistantHost pattern): the sessions render once, through a
// portal, into ONE detached DOM node, and that node is moved into whichever slot shows (the dock, the narrow layer, or a hidden
// holder while the column is closed). Moving a node keeps its subtree, so xterm and its socket never remount.

let node: HTMLDivElement | null = null;
const theNode = (): HTMLDivElement => {
  if (!node) {
    node = document.createElement("div");
    node.className = "flex min-h-0 min-w-0 flex-1 flex-col";
    node.dataset.slot = "terminal-host";
  }
  return node;
};
const noChange = () => () => {};

/** The host node, created on first use in the browser; null on the server and in the first render. */
const useHostNode = (): HTMLDivElement | null => useSyncExternalStore(noChange, theNode, () => null);

/** Renders the sessions into the host node. Mounted for as long as the terminal has been opened once on this page. */
export function HostPortal({ children }: { children: ReactNode }) {
  const host = useHostNode();
  return host ? createPortal(children, host) : null;
}

/** A place the host node can be in. Mounting one takes the node; unmounting gives it back (the next slot takes it). */
export function HostSlot({ className }: { className?: string }) {
  const host = useHostNode();
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el || !host) return;
    el.appendChild(host);
    return () => {
      if (host.parentNode === el) el.removeChild(host);
    };
  }, [host]);
  return <div className={className ?? "flex min-h-0 min-w-0 flex-1 flex-col"} data-slot="terminal-slot" ref={slot} />;
}
