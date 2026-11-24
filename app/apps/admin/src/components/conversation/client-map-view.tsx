"use client";

import { useEffect, useRef, useState } from "react";
import { checkClientMap, mapOutline, type MapClass } from "@hub/diagram/map";
import { adoptSvg, drawMermaid } from "@hub/diagram/render";
import { Skeleton } from "@hub/ui/skeleton";

/**
 * P135 K4: one client map drawn (`@hub/diagram/render`, the one Mermaid entry) and, under it, the same map as an outline, so
 * every state is said in words and a reader without the drawing loses nothing (accessibility rule 6). A text the browser cannot
 * draw shows the outline alone with the reason.
 */

export const MAP_STATE_WORDS: Record<MapClass, string> = { open: "Open", waiting: "Waiting", done: "Done", blocked: "Blocked" };
const INDENT = ["ps-0", "ps-4", "ps-8", "ps-12", "ps-16"] as const;

type Phase = "loading" | "drawn" | "failed";

export function MapDrawing({ source, labelledBy, actual }: { source: string; labelledBy: string; actual: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  useEffect(() => {
    let live = true;
    void drawMermaid(source).then((d) => {
      if (!live || !box.current) return;
      setPhase(d && adoptSvg(box.current, d.markup, labelledBy) ? "drawn" : "failed");
    });
    return () => {
      live = false;
    };
  }, [source, labelledBy]);
  return (
    <div className="min-w-0" data-phase={phase} data-testid="client-map-drawing">
      {phase === "loading" && <Skeleton aria-busy="true" aria-label="Drawing the client map" className="h-64 w-full" role="img" />}
      {phase === "failed" && <p className="text-muted-foreground text-sm" role="status">The drawing could not be made here; the map is listed below as text.</p>}
      <div className="scheme-graph client-map overflow-auto rounded-md border p-3" data-size={actual ? "actual" : "fit"} hidden={phase !== "drawn"} ref={box} />
    </div>
  );
}

export function MapOutline({ source }: { source: string }) {
  const g = checkClientMap(source);
  if (!g.ok) return <p className="text-muted-foreground text-sm">The map could not be read: {g.error}.</p>;
  return (
    <section aria-label="The map as a list" className="flex flex-col gap-1">
      <h3 className="font-medium text-sm">As a list</h3>
      <ul className="flex flex-col gap-0.5 text-sm" data-testid="client-map-outline">
        {mapOutline(g).map((l, i) => (
          <li className={INDENT[Math.min(l.depth, INDENT.length - 1)]} key={`${i}:${l.label}`}>
            {l.via && <span className="text-muted-foreground">{l.via}: </span>}
            <span className={l.depth === 0 ? "font-medium" : undefined}>{l.label}</span>
            {l.state && <span className="text-muted-foreground"> ({MAP_STATE_WORDS[l.state]})</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
