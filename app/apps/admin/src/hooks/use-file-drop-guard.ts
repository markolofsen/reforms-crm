"use client";

import { useEffect } from "react";

/** A drag that carries files (a Finder drag is `types: ["Files"]` only). */
const carriesFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes("Files") ?? false;

/**
 * P76: a file dropped anywhere in the admin but on the terminal does nothing. Without this, Chrome opens a dropped image or
 * PDF in the tab (the admin is gone) and downloads anything else. File drags only: a text drag into an input still lands
 * there. The terminal's own drop target stops its events first (bubbling, no capture here), so it still takes its drops.
 */
export function useFileDropGuard(): void {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    const drop = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}
