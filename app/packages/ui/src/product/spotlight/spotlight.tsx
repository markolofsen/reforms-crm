"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { announcement, hasBox, isTyping, refSelector, SPOTLIGHT_WAIT_MS, type SpotlightOutcome } from "./model";

export { SPOTLIGHT_WAIT_MS, isTyping, refSelector, announcement, type SpotlightOutcome } from "./model";

type Props = {
  /** The pointer's refs; each is found by a live query of `[attribute="<ref>"]` inside `root` at draw time, never a kept node. */
  refs: readonly string[];
  /** A few words of the agent's, shown as text beside the first ring ("Agent: …"). */
  note: string | null;
  /** How long until it expires. */
  ttlMs: number;
  /** Told once: `shown` (with the refs it could not find on screen), `not-on-screen`, `dismissed` (Escape or a click), `expired`. */
  onOutcome: (outcome: SpotlightOutcome, missing: readonly string[]) => void;
  root?: string;
  attribute?: string;
};

type Box = { top: number; left: number; width: number; height: number };

const boxesOf = (els: readonly Element[]): Box[] => els.map((el) => el.getBoundingClientRect()).filter(hasBox).map((r) => ({ top: r.top, left: r.left, width: r.width, height: r.height }));

/**
 * A pointer drawn over rows (P72, decision 0038; djangocfg `highlight-overlay`): a ring on each row a ref names and a caption
 * "Agent: <note>" as text, announced in a polite status region. It waits at most 800 ms for a row to be visible, scrolls the
 * first one into view once (`block: "nearest"`) unless he is typing, and goes on Escape, a click anywhere or when it expires.
 * It never moves focus and changes nothing on the page. Mount it with a `key` per pointer: one mount, one outcome.
 */
export function Spotlight({ refs, note, ttlMs, onOutcome, root = "#main", attribute = "data-agent-ref" }: Props) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const scope = document.querySelector(root);
    if (!scope) return;
    let told = false;
    const tell = (o: SpotlightOutcome, missing: readonly string[] = []) => {
      if (told && o !== "dismissed" && o !== "expired") return;
      told = true;
      onOutcome(o, missing);
    };
    const find = () => refs.map((ref) => ({ ref, els: [...scope.querySelectorAll(refSelector(attribute, ref))].filter((el) => hasBox(el.getBoundingClientRect())) }));
    let frame = 0;
    let drawn: Element[] = [];
    let ended = false;
    const end = (o: SpotlightOutcome) => {
      if (ended) return;
      ended = true;
      setDone(true);
      tell(o);
    };
    let last = "";
    const follow = () => {
      if (ended) return;
      // The rows move with the scroll and the layout: re-measured every frame while drawn (a render only when a box moved).
      drawn = drawn.filter((el) => el.isConnected);
      const next = boxesOf(drawn);
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setBoxes(next);
      }
      frame = window.requestAnimationFrame(follow);
    };
    const started = performance.now();
    const wait = () => {
      if (ended) return;
      const found = find();
      const seen = found.filter((f) => f.els.length > 0);
      if (seen.length < refs.length && performance.now() - started < SPOTLIGHT_WAIT_MS) {
        frame = window.requestAnimationFrame(wait);
        return;
      }
      if (seen.length === 0) {
        ended = true;
        setDone(true);
        tell("not-on-screen", refs);
        return;
      }
      drawn = seen.flatMap((f) => f.els);
      if (!isTyping(document.activeElement instanceof HTMLElement ? document.activeElement : null)) drawn[0]?.scrollIntoView({ block: "nearest" });
      tell("shown", found.filter((f) => f.els.length === 0).map((f) => f.ref));
      follow();
    };
    frame = window.requestAnimationFrame(wait);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end("dismissed");
    };
    const onPress = () => end("dismissed");
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPress, true);
    const timer = window.setTimeout(() => end("expired"), Math.max(0, ttlMs));
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPress, true);
    };
    // One mount is one pointer (the caller keys it): the refs and the note do not change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done || boxes.length === 0) return null;
  const first = boxes[0];
  return createPortal(
    <>
      <p className="sr-only" role="status">
        {announcement(boxes.length, note)}
      </p>
      {boxes.map((b, i) => (
        <div aria-hidden="true" className="pointer-events-none fixed z-50 rounded-md ring-2 ring-primary ring-offset-2 ring-offset-background" data-spotlight="" key={i} style={{ top: b.top, left: b.left, width: b.width, height: b.height }} />
      ))}
      {first && note && (
        <p aria-hidden="true" className="pointer-events-none fixed z-50 truncate rounded-md bg-primary px-2 py-0.5 text-primary-foreground text-xs shadow-sm" data-spotlight-note="" style={{ top: Math.max(4, first.top - 26), left: first.left, maxWidth: Math.max(160, first.width) }}>
          Agent: {note}
        </p>
      )}
    </>,
    document.body,
  );
}
