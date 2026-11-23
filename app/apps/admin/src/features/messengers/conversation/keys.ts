import { useHotkeys } from "@hub/ui/use-hotkey";

/**
 * Messengers' action keys (P127 C2 question 1, delegated: yes), beside the shared list keys of
 * `components/conversation/list/keys.ts`; the `?` popover lists both. S and E act on the open chat's draft and register only while
 * it is on screen; U undoes the last Skip, so it stays registered after that draft has gone. None of them sends: Send is the
 * draft's button and its review dialog (P105, the door of decision 0046).
 */
export const MESSENGER_DRAFT_KEYS: readonly (readonly [string, string])[] = [
  ["S", "skip the open draft (Undo on its toast)"],
  ["E", "edit the open draft"],
];
export const MESSENGER_UNDO_KEYS: readonly (readonly [string, string])[] = [["U", "undo the last Skip"]];

/** S and E on the open draft; off while a move is pending or the editor is open (the editor owns its keys). */
export function useMessengerDraftKeys(k: { enabled: () => boolean; busy: boolean; editing: boolean; skip: () => void; edit: () => void }): void {
  const idle = () => !k.busy && !k.editing;
  useHotkeys(
    {
      s: (e) => {
        if (!idle()) return;
        e.preventDefault();
        k.skip();
      },
      e: (e) => {
        if (!idle()) return;
        e.preventDefault();
        k.edit();
      },
    },
    k.enabled,
    MESSENGER_DRAFT_KEYS,
  );
}

/** U: put the last skipped draft back (the same Restore as the toast's Undo). Nothing to undo: nothing happens. */
export function useMessengerUndoKey(k: { enabled: () => boolean; undo: (() => void) | null }): void {
  useHotkeys({ u: () => k.undo?.() }, k.enabled, MESSENGER_UNDO_KEYS);
}
