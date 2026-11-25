import { TONES } from "@hub/config";
import { useHotkeys } from "@hub/ui/use-hotkey";
import { isClosed, type ReviewDraft } from "@/features/mail/model";
import type { ReviewActions } from "./use-review-actions";

/**
 * Mail's action keys (P127 C2, V9), beside the shared list keys of `components/conversation/list/keys.ts`; the `?` popover lists
 * both. They act on the open person's unsent draft; a closed draft takes none.
 */
export const MAIL_ACTION_KEYS: readonly (readonly [string, string])[] = [
  ["Shift Enter", "send: opens the review dialog; its Send sends (a press right after it opens does not count)"],
  ["C", "Checked for Send all Checked: on opens the review dialog, off at once"],
  ["R", "reply in Mail (batch drafts)"],
  ["D", "done, then the next draft"],
  ["S", "skip, then the next draft"],
  ["H", "hold, or back to ready"],
  ["U", "undo the last Done, Skip or Hold (also on its toast)"],
  ["1 2 3", "short, standard, warm version"],
  ["!", "spam: their mail to Mail's Junk (no draft open)"],
  ["#, Backspace", "delete: their mail to Mail's Trash (no draft open)"],
];

export type MailKeyDeps = {
  enabled: () => boolean;
  /** The open person's open draft: the keys act on it. */
  current: ReviewDraft | null;
  actions: ReviewActions;
  advance: (d: ReviewDraft) => void;
  replyAll: (d: ReviewDraft) => void;
  /** `C`: switch Checked on or off, through the same guard as the switch (it refuses an unreadable draft or one with no text hash). */
  toggleChecked: (d: ReviewDraft) => void;
  undoLast: (() => void) | null;
  /** P147 3n: Spam or Delete of the open person's mail, when they have one and no open draft (the pane shows the same buttons). */
  move: ((to: "junk" | "trash") => void) | null;
  say: (text: string) => void;
};

export function useMailKeys(k: MailKeyDeps): void {
  const { current: d, actions } = k;
  const open = d !== null && !isClosed(d);
  const act = (fn: (d: ReviewDraft) => void) => () => {
    if (d && open) fn(d);
  };
  const tone = (n: number) => () => {
    const t = TONES[n];
    if (!d || !open || !t) return;
    if (d.toneBodies[t] === undefined) k.say("That version does not exist for this draft.");
    else if (d.tone !== t) actions.setTone(d, t);
  };
  useHotkeys(
    {
      u: () => (k.undoLast ? k.undoLast() : actions.undoKey(d)),
      c: act(k.toggleChecked),
      r: act(k.replyAll),
      d: act((x) => { k.advance(x); actions.setStatus(x, "done"); }),
      s: act((x) => { k.advance(x); actions.setStatus(x, "skipped"); }),
      h: act((x) => actions.setStatus(x, x.status === "hold" ? "ready" : "hold")),
      1: tone(0),
      2: tone(1),
      3: tone(2),
      "!": () => k.move?.("junk"),
      "#": () => k.move?.("trash"),
      backspace: () => k.move?.("trash"),
    },
    k.enabled,
    MAIL_ACTION_KEYS,
  );
}
