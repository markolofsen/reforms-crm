"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { classifyDrop, dragKind, type Dropped } from "./drop";

/**
 * P76: the terminal box as a drop target. While a drag of files or text is over it, `dragging` says which (the view draws
 * a ring and one line); on drop the classified drop goes to `onDrop`. Every handled event stops here, so the page's own
 * guard (which swallows a file dropped anywhere else) never sees it, and the browser never opens the file or types the text
 * into xterm's hidden textarea. A counter of enters and leaves keeps the ring steady over xterm's own children.
 */
export function useDropTarget(box: RefObject<HTMLElement | null>, onDrop: RefObject<((d: Dropped) => void) | undefined>): "files" | "text" | null {
  const [dragging, setDragging] = useState<"files" | "text" | null>(null);
  const depth = useRef(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const kind = (e: DragEvent) => (e.dataTransfer ? dragKind(Array.from(e.dataTransfer.types)) : null);
    const take = (e: DragEvent) => {
      // No taker (the program ended): the page's guard swallows a file, and nothing is pasted.
      const k = onDrop.current ? kind(e) : null;
      if (!k) return null;
      e.preventDefault();
      e.stopPropagation();
      return k;
    };
    const enter = (e: DragEvent) => {
      const k = take(e);
      if (!k) return;
      depth.current += 1;
      setDragging(k);
    };
    const over = (e: DragEvent) => {
      if (take(e) && e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!take(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(null);
    };
    const drop = (e: DragEvent) => {
      if (!take(e) || !e.dataTransfer) return;
      depth.current = 0;
      setDragging(null);
      onDrop.current?.(classifyDrop(e.dataTransfer));
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [box, onDrop]);
  return dragging;
}
