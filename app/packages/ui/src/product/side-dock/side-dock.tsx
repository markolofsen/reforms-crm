"use client";

import { useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { cn } from "../../cn";
import { DOCK_WIDTH, clampWidth, dragWidth, keyWidth, maxWidth } from "./size";

// The consumer stores the width; it reads a stored text back with `parseWidth` and starts from `DOCK_WIDTH.default`.
export { DOCK_WIDTH, parseWidth } from "./size";

const onViewport = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const viewportWidth = () => window.innerWidth;
/** The server has no viewport: 0 sets no upper bound (`maxWidth`). */
const noViewport = () => 0;

type Props = {
  /** The name of the column (`<aside aria-label>`); the separator is "Resize <label>". */
  label: string;
  /** The saved width. The drawn width is clamped to the viewport; the saved one is changed only by the person. */
  width: number;
  onWidth: (width: number) => void;
  children: ReactNode;
  className?: string;
};

/**
 * A full-height column inside its host with a resize separator on its start edge (the window splitter pattern):
 * drag with a pointer (captured, so it never loses the drag to the content), ArrowLeft and ArrowRight in 24px steps, Home or
 * a double click back to the default. The width is clamped between 400px and 60 % of the viewport and re-clamped when the
 * viewport changes, without overwriting the saved width. It is set once, as `--terminal-w`, for the column and its content.
 */
export function SideDock({ label, width, onWidth, children, className }: Props) {
  const viewport = useSyncExternalStore(onViewport, viewportWidth, noViewport);
  const [live, setLive] = useState<number | null>(null);
  const liveRef = useRef<number | null>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const drawn = clampWidth(live ?? width, viewport);
  const max = Math.min(maxWidth(viewport), Math.max(drawn, DOCK_WIDTH.min));
  const style: CSSProperties & Record<"--terminal-w", string> = { "--terminal-w": `${drawn}px` };
  const end = () => {
    if (!drag.current) return;
    const finalWidth = liveRef.current;
    drag.current = null;
    liveRef.current = null;
    setLive(null);
    if (finalWidth !== null) onWidth(finalWidth);
  };
  return (
    <div className={cn("flex h-full min-h-0 shrink-0", className)} data-slot="side-dock" style={style}>
      {/* A focusable separator is a widget in ARIA 1.2 (the window splitter pattern); aria-query still files it under structure. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the window splitter: see above */}
      <div
        aria-label={`Resize ${label}`}
        aria-orientation="vertical"
        aria-valuemax={Number.isFinite(max) ? max : drawn}
        aria-valuemin={DOCK_WIDTH.min}
        aria-valuenow={drawn}
        aria-valuetext={`${drawn} pixels`}
        className="relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none select-none outline-none before:absolute before:inset-y-0 before:start-1/2 before:w-px before:bg-border hover:before:w-0.5 hover:before:bg-ring focus-visible:before:w-0.5 focus-visible:before:bg-ring data-dragging:before:w-0.5 data-dragging:before:bg-ring"
        data-dragging={live !== null ? "" : undefined}
        onDoubleClick={() => onWidth(DOCK_WIDTH.default)}
        onKeyDown={(e) => {
          const next = keyWidth(e.key, drawn, viewport);
          if (next === null) return;
          e.preventDefault();
          onWidth(next);
        }}
        onLostPointerCapture={end}
        onPointerCancel={end}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { startX: e.clientX, startWidth: drawn };
          liveRef.current = drawn;
          setLive(drawn);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            const next = dragWidth(d.startWidth, d.startX, e.clientX, viewport);
            liveRef.current = next;
            setLive(next);
          }
        }}
        onPointerUp={end}
        role="separator"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the window splitter: see above
        tabIndex={0}
      />
      <aside aria-label={label} className="flex min-h-0 w-(--terminal-w) min-w-0 flex-col bg-background" data-slot="side-dock-panel">
        {children}
      </aside>
    </div>
  );
}

/**
 * The column's box before it can be drawn (P128 X8): the server and the first render know the saved width but no viewport and
 * no content, so the screen beside it is laid out at its final width and names nothing (no column, no separator).
 */
export function SideDockPlaceholder({ width, className }: { width: number; className?: string }) {
  const style: CSSProperties & Record<"--terminal-w", string> = { "--terminal-w": `${clampWidth(width, 0)}px` };
  return <div aria-hidden="true" className={cn("h-full w-(--terminal-w) shrink-0 border-s bg-background", className)} data-slot="side-dock-placeholder" style={style} />;
}
