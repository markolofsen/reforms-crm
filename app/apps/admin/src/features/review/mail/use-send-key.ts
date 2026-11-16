import { useEffect, useRef } from "react";

const TYPING = "input,textarea,select,[contenteditable]";

/**
 * Shift+Enter is the send key of an open card (P27 M4): the first press reads Mail and shows the confirmation, the
 * second sends what was shown. It is never a plain key, so Enter keeps its meaning in the list and on every button, and
 * it does nothing while a person types or when the card has no send to make.
 */
export function useSendKey(run: (() => void) | null): void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.target instanceof Element && e.target.closest(TYPING)) return;
      if (!latest.current) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
