import { useHotkey } from "@hub/ui/use-hotkey";

/**
 * Shift+Enter is the send key of an open card (P27 M4; P105): it opens the review dialog, whose Send sends. A confirm right after
 * the dialog opens is ignored there (`REVIEW_DWELL_MS`), so a held key never sends what nobody read. It is never a plain key, so
 * Enter keeps its meaning in the list and on every button, and it does nothing while a person types (or in an open menu or
 * dialog) or when the card has no send to make.
 */
export function useSendKey(run: (() => void) | null): void {
  useHotkey("Shift+Enter", () => run?.(), run !== null);
}
