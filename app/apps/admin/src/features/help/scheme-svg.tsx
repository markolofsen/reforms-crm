import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@hub/ui/skeleton";

/**
 * The drawing (P63 O2, decision 0035): Mermaid text in, one parsed SVG out. The one file that imports `mermaid` (only through
 * `import()`, after mount, so no other route's bundle grows) and the one exception to the injected-markup ban
 * (`architecture-and-ownership.md` rule 3): the SVG is parsed as strict XML, stripped once more of scripts, foreign objects,
 * event attributes, links and Mermaid's own `<style>` (the theme is `scheme-graph` in `@hub/ui/styles.css`, so light and dark
 * need no new render), and adopted into a ref with `replaceChildren`. Nothing is executed. Re-renders only when the text changes.
 */

type Phase = "loading" | "ready" | "failed";

let initialized = false;
let renders = 0;

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

export function SchemeSvg({ text, labelledBy }: { text: string; labelledBy: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        if (!initialized) {
          const font = getComputedStyle(document.body).fontFamily;
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", layout: "dagre", deterministicIds: true, htmlLabels: false, logLevel: "fatal", themeVariables: { fontFamily: font, fontSize: "13px" }, flowchart: { curve: "basis", nodeSpacing: 24, rankSpacing: 48, padding: 10, wrappingWidth: 260 } });
          initialized = true;
        }
        renders += 1;
        const { svg } = await mermaid.render(`hub-scheme-${renders}`, text);
        const el = cleanSvg(svg);
        if (!live) return;
        if (!el || !box.current) {
          setPhase("failed");
          return;
        }
        const [, , w, h] = (el.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
        el.removeAttribute("style");
        if (w && h) {
          el.setAttribute("width", String(Math.ceil(w)));
          el.setAttribute("height", String(Math.ceil(h)));
        }
        el.setAttribute("role", "img");
        el.setAttribute("aria-labelledby", labelledBy);
        el.removeAttribute("aria-roledescription");
        box.current.replaceChildren(document.adoptNode(el));
        setPhase("ready");
      } catch {
        if (live) setPhase("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [text, labelledBy]);

  return (
    <>
      {phase === "loading" && <Skeleton aria-busy="true" aria-label="Drawing the scheme" className="h-64 w-full" role="img" />}
      {phase === "failed" && (
        <p className="text-muted-foreground text-sm" data-testid="scheme-failed">
          The drawing could not be made here; every part and how it stands is listed on Overview.
        </p>
      )}
      {/* A scroll box below the drawing's width: focusable so the keyboard can scroll it (one tab stop, no control inside). */}
      <div aria-labelledby={labelledBy} className="scheme-graph overflow-x-auto rounded-md border p-3" data-testid="scheme-svg" hidden={phase !== "ready"} ref={box} role="region" tabIndex={0} />
    </>
  );
}
