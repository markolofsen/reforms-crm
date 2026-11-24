import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { SCHEME_WORDS, type SchemeState } from "@hub/contract/scheme";
import { Skeleton } from "@hub/ui/skeleton";
import { adoptSvg, drawMermaid } from "@hub/diagram/render";

/**
 * A drawing (P63 O2, decision 0035; P81, decision 0042): Mermaid text in, one parsed SVG out, drawn by `@hub/diagram/render` (P135
 * verdict 7: the one Mermaid entry, which loads `mermaid` through `import()` only and cleans the SVG before it is adopted).
 *
 * P81: it takes the drawing's forms, widest first, and shows the first one that fits the card with no label under 12 px (the
 * SVG scales down to the card, never above its own size); when none fits it shows `list`, the same blocks as text. The card's
 * width is measured on a box that is always there; each text is rendered once per page load and kept, so a resize only picks
 * again. A block's standing becomes a dot (an SVG `circle` with its word as `<title>`); an unchecked block stays a plain box.
 */

type Phase = "loading" | "drawn" | "list" | "failed";

/** Labels are 13 px; a drawing scaled below this would set one under 12 px. */
const MIN_SCALE = 12 / 13;
/** The drawing box's padding and border (`p-3`, `border`), both sides. */
const BOX_INSET = 26;
const STATES: readonly SchemeState[] = ["ok", "warn", "fail"];

/** A dot in the top right corner of every block with a standing, created as elements (never markup), its word as its title. */
function addDots(svg: SVGSVGElement): void {
  const ns = "http://www.w3.org/2000/svg";
  for (const node of Array.from(svg.querySelectorAll("g.node"))) {
    const state = STATES.find((s) => node.classList.contains(s));
    const shape = node.querySelector(":scope > rect");
    if (!state || !shape) continue;
    const n = (a: string) => Number(shape.getAttribute(a) ?? 0);
    const dot = svg.ownerDocument.createElementNS(ns, "circle");
    dot.setAttribute("class", "scheme-dot");
    dot.setAttribute("cx", String(n("x") + n("width") - 9));
    dot.setAttribute("cy", String(n("y") + 9));
    dot.setAttribute("r", "4.5");
    const title = svg.ownerDocument.createElementNS(ns, "title");
    title.textContent = SCHEME_WORDS[state];
    dot.append(title);
    node.append(dot);
  }
}

/** The first form that fits `room` at 12 px or more, its text and markup; undefined when none fits; null when one could not be drawn. */
async function pick(texts: readonly string[], room: number): Promise<{ text: string; markup: string } | null | undefined> {
  for (const text of texts) {
    const d = await drawMermaid(text);
    if (!d) return null;
    if (d.width * MIN_SCALE <= room) return { text, markup: d.markup };
  }
  return undefined;
}

/** The card's inner width, 0 until measured (never read in the first render: `state-and-data.md` rule 11). */
function useRoom(ref: RefObject<HTMLDivElement | null>): number {
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRoom(Math.floor((e?.contentRect.width ?? 0) - BOX_INSET)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return room;
}

export function SchemeSvg({ texts, labelledBy, list, testId }: { texts: readonly string[]; labelledBy: string; list: ReactNode; testId: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const room = useRoom(wrap);

  useEffect(() => {
    if (room <= 0) return;
    let live = true;
    void pick(texts, room).then((p) => {
      if (!live || !box.current) return;
      if (p === null) return setPhase("failed");
      if (p === undefined) return setPhase("list");
      if (shown.current !== p.text) {
        if (!adoptSvg(box.current, p.markup, labelledBy, addDots)) return setPhase("failed");
        shown.current = p.text;
      }
      setPhase("drawn");
    });
    return () => {
      live = false;
    };
  }, [texts, room, labelledBy]);

  return (
    <div className="min-w-0" data-form={phase} data-testid={testId} ref={wrap}>
      {phase === "loading" && <Skeleton aria-busy="true" aria-label="Drawing the scheme" className="h-64 w-full" role="img" />}
      {phase === "failed" && <p className="text-muted-foreground text-sm">The drawing could not be made here; every part and how it stands is listed on Overview.</p>}
      {(phase === "list" || phase === "failed") && list}
      <div className="scheme-graph rounded-md border p-3" data-testid="scheme-svg" hidden={phase !== "drawn"} ref={box} />
    </div>
  );
}
