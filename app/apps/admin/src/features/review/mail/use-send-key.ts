import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/hooks/use-hotkeys";

/** After the preview appears, a second Shift+Enter does not confirm for this long: a double tap must not send what nobody read. The button stays instant. */
export const CONFIRM_DWELL_MS = 400;

/** Whether the dwell is over. `shownAt` is when the preview appeared (null: no preview is waiting); `now` comes from the clock. */
export const dwellPassed = (shownAt: number | null, now: number, dwell: number = CONFIRM_DWELL_MS): boolean => shownAt === null || now - shownAt >= dwell;

/**
 * Shift+Enter is the send key of an open card (P27 M4): the first press reads Mail and shows the confirmation, the
 * second sends what was shown. It is never a plain key, so Enter keeps its meaning in the list and on every button, and
 * it does nothing while a person types (or in an open menu or dialog) or when the card has no send to make.
 */
export function useSendKey(run: (() => void) | null): void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      if (!latest.current) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
