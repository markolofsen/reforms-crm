// P135 verdict 7 (P63 O2, decision 0035; P81, decision 0042): the Hub's one Mermaid entry in the browser. Mermaid text in, one
// parsed SVG out. `mermaid` is loaded only through `import()`, on the first drawing, so no route's bundle grows. The SVG is parsed
// as strict XML, stripped of scripts, foreign objects, event attributes, links and Mermaid's own `<style>` (the theme is the
// admin's tokens: `scheme-graph` and `client-map` in `@hub/ui/styles.css`, so light and dark need no new render), and adopted
// into a box with `replaceChildren`. Nothing is executed. Help's scheme and the client map both draw through here.

export type Drawn = { markup: string; width: number };

let initialized = false;
let renders = 0;
const drawn = new Map<string, Promise<Drawn | null>>();

async function render(text: string): Promise<Drawn | null> {
  const { default: mermaid } = await import("mermaid");
  if (!initialized) {
    const font = getComputedStyle(document.body).fontFamily;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", layout: "dagre", deterministicIds: true, htmlLabels: false, logLevel: "fatal", themeVariables: { fontFamily: font, fontSize: "13px" }, flowchart: { curve: "basis", nodeSpacing: 12, rankSpacing: 24, padding: 6, wrappingWidth: 140 } });
    initialized = true;
  }
  renders += 1;
  const { svg } = await mermaid.render(`hub-diagram-${renders}`, text);
  const width = Number((/viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/.exec(svg) ?? [])[1] ?? 0);
  return width > 0 ? { markup: svg, width } : null;
}

/** Draws a text once per page load (kept by its text); null when Mermaid cannot draw it. Never throws. */
export function drawMermaid(text: string): Promise<Drawn | null> {
  const known = drawn.get(text);
  if (known) return known;
  const p = render(text).catch(() => null);
  drawn.set(text, p);
  return p;
}

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

/**
 * Puts a cleaned SVG into `box` as its only child: its own size as width and height (it scales down to the box, never up), named by
 * the element `labelledBy` points at, Mermaid's role description dropped. `decorate` may add elements (never markup) first.
 */
export function adoptSvg(box: HTMLElement, markup: string, labelledBy: string, decorate?: (svg: SVGSVGElement) => void): boolean {
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
  decorate?.(el);
  box.replaceChildren(document.adoptNode(el));
  return true;
}
