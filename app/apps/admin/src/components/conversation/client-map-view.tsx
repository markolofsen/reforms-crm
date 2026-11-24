"use client";

import { useEffect, useRef, useState } from "react";
import { MAP_CLASSES, checkClientMap, mapOutline, type MapSources } from "@hub/diagram/map";
import { adoptSvg, drawMermaid } from "@hub/diagram/render";
import { cn } from "@hub/ui/cn";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationHistoryNotice } from "@hub/ui/product/conversation/frame";
import { Skeleton } from "@hub/ui/skeleton";
import { plural } from "@/lib/format";
import { MAP_STATE_WORDS } from "./client-map-sources";

/**
 * P135 K4: one client map drawn (`@hub/diagram/render`, the one Mermaid entry) and, under it, the same map as an outline, so
 * every state is said in words and a reader without the drawing loses nothing (accessibility rule 6). A text the browser cannot
 * draw shows the outline alone with the reason.
 */

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

/** The four states as the drawing colours them, each with its word (P136 verdict 7e). */
export function MapLegend() {
  return (
    <ul aria-label="The states" className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs" data-testid="client-map-legend">
      {MAP_CLASSES.map((c) => (
        <li className="flex items-center gap-1.5" key={c}>
          <span aria-hidden="true" className="client-map-swatch size-3 rounded-sm border-2" data-state={c} />
          {MAP_STATE_WORDS[c]}
        </li>
      ))}
    </ul>
  );
}

/**
 * The map as an outline, every state in words. P136 verdict 7c: a node that names its sources is a button that shows those
 * messages in the thread (`onShow`); the count says how many it rests on.
 */
export function MapOutline({ source, sources, onShow }: { source: string; sources: MapSources; onShow?: (id: string, label: string) => void }) {
  const g = checkClientMap(source, { sources: "optional" });
  if (!g.ok) return <p className="text-muted-foreground text-sm">The map could not be read: {g.error}.</p>;
  return (
    <section aria-label="The map as a list" className="flex flex-col gap-1">
      <h3 className="font-medium text-sm">As a list</h3>
      <ul className="flex flex-col gap-0.5 text-sm" data-testid="client-map-outline">
        {mapOutline(g).map((l, i) => {
          const refs = sources[l.id] ?? g.sources[l.id] ?? [];
          const count = refs.length === 1 ? "1 source" : `${refs.length} sources`;
          return (
            <li className={cn("flex flex-wrap items-center gap-x-2", INDENT[Math.min(l.depth, INDENT.length - 1)])} key={`${i}:${l.id}`}>
              <span>
                {l.via && <span className="text-muted-foreground">{l.via}: </span>}
                <span className={l.depth === 0 ? "font-medium" : undefined}>{l.label}</span>
                {l.state && <span className="text-muted-foreground"> ({MAP_STATE_WORDS[l.state]})</span>}
              </span>
              {onShow && refs.length > 0 && (
                // The name holds the words on the button ("1 source"), so a voice command that says them reaches it (WCAG 2.5.3).
                <ActionButton aria-label={`Show ${count} of ${l.label} in the thread`} data-testid="client-map-source" onClick={() => onShow(l.id, l.label)} size="s" variant="quiet">
                  {count}
                </ActionButton>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** P136 verdict 7c: the messages a map node rests on, ringed in the thread until the owner clears them. */
export type MapMarks = { keys: readonly string[]; label: string; onClear: () => void };

/** The line over the thread while a node's sources are ringed (Mail and Messengers): how many, of which node, and Clear. */
export function MapMarksNote({ marks }: { marks: MapMarks }) {
  const n = marks.keys.length;
  return (
    <ConversationHistoryNotice>
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="map-marks">
        <p className="me-auto" role="status">
          {n === 0 ? `No message shown here holds the source of “${marks.label}”.` : `${plural(n, "message")} ringed: the source of “${marks.label}”.`}
        </p>
        <ActionButton onClick={marks.onClear} size="s" variant="quiet">
          Clear
        </ActionButton>
      </div>
    </ConversationHistoryNotice>
  );
}
