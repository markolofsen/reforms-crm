import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { SCHEME_WORDS, type SchemeState } from "@hub/contract/scheme";
import { Skeleton } from "@hub/ui/skeleton";

/**
 * A drawing (P63 O2, decision 0035; P81, decision 0042): Mermaid text in, one parsed SVG out. The one file that imports
 * `mermaid` (only through `import()`, after mount, so no other route's bundle grows) and the one exception to the injected-markup
 * ban (`architecture-and-ownership.md` rule 3): the SVG is parsed as strict XML, stripped once more of scripts, foreign objects,
 * event attributes, links and Mermaid's own `<style>` (the theme is `scheme-graph` in `@hub/ui/styles.css`, so light and dark
 * need no new render), and adopted into a ref with `replaceChildren`. Nothing is executed.
 *
 * P81: it takes the drawing's forms, widest first, and shows the first one that fits the card with no label under 12 px (the
 * SVG scales down to the card, never above its own size); when none fits it shows `list`, the same blocks as text. The card's
 * width is measured on a box that is always there; each text is rendered once per page load and kept, so a resize only picks
 * again. A block's standing becomes a dot (an SVG `circle` with its word as `<title>`); an unchecked block stays a plain box.
 */

type Drawn = { markup: string; width: number } | null;
type Phase = "loading" | "drawn" | "list" | "failed";

/** Labels are 13 px; a drawing scaled below this would set one under 12 px. */
const MIN_SCALE = 12 / 13;
/** The drawing box's padding and border (`p-3`, `border`), both sides. */
const BOX_INSET = 26;
const STATES: readonly SchemeState[] = ["ok", "warn", "fail"];

let initialized = false;
let renders = 0;
const drawn = new Map<string, Promise<Drawn>>();

/** Parses Mermaid's SVG and keeps only drawing: no script, no foreign object, no style, no `on*` attribute, no link. Null when it does not parse. */
export function cleanSvg(markup: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const svg = doc.documentElement;
  if (!(svg instanceof SVGSVGElement)) return null;
  for (const el of Array.from(svg.querySelectorAll("script, foreignObject, style, a, iframe, image, use"))) el.remove();
  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name) || /href$/i.test(a.name)) el.removeAttribute(a.name);
  }
  return svg;
}

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

async function render(text: string): Promise<Drawn> {
  const { default: mermaid } = await import("mermaid");
  if (!initialized) {
    const font = getComputedStyle(document.body).fontFamily;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", layout: "dagre", deterministicIds: true, htmlLabels: false, logLevel: "fatal", themeVariables: { fontFamily: font, fontSize: "13px" }, flowchart: { curve: "basis", nodeSpacing: 12, rankSpacing: 24, padding: 6, wrappingWidth: 140 } });
    initialized = true;
  }
  renders += 1;
  const { svg } = await mermaid.render(`hub-scheme-${renders}`, text);
  const width = Number((/viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/.exec(svg) ?? [])[1] ?? 0);
  return width > 0 ? { markup: svg, width } : null;
}

const drawOnce = (text: string): Promise<Drawn> => {
  const known = drawn.get(text);
  if (known) return known;
  const p = render(text).catch(() => null);
  drawn.set(text, p);
  return p;
};

/** The first form that fits `room` at 12 px or more, its text and markup; undefined when none fits; null when one could not be drawn. */
async function pick(texts: readonly string[], room: number): Promise<{ text: string; markup: string } | null | undefined> {
  for (const text of texts) {
    const d = await drawOnce(text);
    if (!d) return null;
    if (d.width * MIN_SCALE <= room) return { text, markup: d.markup };
  }
  return undefined;
}

function adopt(box: HTMLDivElement, markup: string, labelledBy: string): boolean {
  const el = cleanSvg(markup);
  if (!el) return false;
  const [, , w, h] = (el.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  el.removeAttribute("style");
  if (w && h) {
    el.setAttribute("width", String(Math.ceil(w)));
    el.setAttribute("height", String(Math.ceil(h)));
  }
  el.setAttribute("role", "img");
  el.setAttribute("aria-labelledby", labelledBy);
  el.removeAttribute("aria-roledescription");
  addDots(el);
  box.replaceChildren(document.adoptNode(el));
  return true;
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
        if (!adopt(box.current, p.markup, labelledBy)) return setPhase("failed");
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
