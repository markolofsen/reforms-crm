import { TONES } from "@hub/config";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { isClosed, type ReviewDraft } from "./source";
import type { ReviewActions } from "./use-review-actions";

// One key map for both review screens; the `?` popover lists it (the keys register themselves through `useHotkeys`).
export const REVIEW_KEYS: readonly (readonly [string, string])[] = [
  ["J / K", "next / previous draft"],
  ["Enter, L, Right", "into the draft: its main action"],
  ["Shift Enter", "send: read Mail, then confirm what it shows (the second press counts after a short pause)"],
  ["Esc, Left", "back to the list; clears a selection first"],
  ["C", "I read the checks, on or off (only once the text was read)"],
  ["X", "select or unselect the draft"],
  ["Shift A", "select every open draft in the list"],
  ["R", "reply in Mail (batch drafts)"],
  ["D", "done, then the next draft"],
  ["S", "skip, then the next draft"],
  ["H", "hold, or back to ready"],
  ["U", "undo the last Done, Skip or Hold (also on its toast)"],
  ["1 2 3", "short, standard, warm version"],
  ["T", "show or hide the thread"],
  ["/", "search"],
];

const inside = (el: Element | null, pane: string) => el?.closest(`[data-pane="${pane}"]`) != null;
const popupOpen = () => document.querySelector('[data-slot$="-popup"], [role="dialog"], [role="menu"]') !== null;

/** Focus a row's button once it has rendered: after Done or Skip the card that held focus is gone, so focus follows to the next draft. */
export function focusRow(id: number | null): void {
  if (id === null) return;
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`#draft-${id} button[data-variant]`)?.focus());
}

/** Focus the first thing to do in the open card: its primary action, else its first control. */
export function focusDetail(): void {
  requestAnimationFrame(() => {
    const pane = document.querySelector('[data-pane="detail"]');
    const target = pane?.querySelector<HTMLElement>('[data-variant="primary"]:not(:disabled)') ?? pane?.querySelector<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled)");
    target?.focus();
  });
}

export type KeyDeps = {
  enabled: () => boolean;
  rows: ReviewDraft[];
  current: ReviewDraft | null;
  actions: ReviewActions;
  go: (id: number | null, focus?: boolean) => void;
  advance: (d: ReviewDraft) => void;
  replyAll: (d: ReviewDraft) => void;
  /** `C`: switch Checked on or off, through the same guard as the switch (it refuses an unreadable draft or one with no text hash). */
  toggleChecked: (d: ReviewDraft) => void;
  undoLast: (() => void) | null;
  toggleSelect: (id: number) => void;
  toggleThread: () => void;
  selectAll: () => void;
  selected: number;
  clearSelection: () => void;
  /** Esc on a phone is the Back control. */
  back: (() => void) | null;
  focusSearch: () => void;
  say: (text: string) => void;
};

/** The shared key map. Closed drafts take no action keys; moving, search, help and the thread always work. */
export function useReviewKeys(k: KeyDeps): void {
  const { rows, current: d, actions } = k;
  const index = d ? rows.findIndex((r) => r.id === d.id) : -1;
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
  // Moving between the panes only starts from the list (or nowhere in particular): a button in the card keeps its own Enter.
  const fromList = () => document.activeElement === null || document.activeElement === document.body || inside(document.activeElement, "list");
  const intoDetail = (e: { preventDefault: () => void }) => {
    if (!d || !fromList()) return;
    e.preventDefault();
    focusDetail();
  };
  const outOfDetail = (clears: boolean) => () => {
    if (popupOpen()) return;
    if (clears && k.selected > 0) k.clearSelection();
    else if (inside(document.activeElement, "detail")) (k.back ?? (() => focusRow(d?.id ?? null)))();
  };
  useHotkeys(
    {
      j: (e) => { e.preventDefault(); k.go(rows[Math.min(index + 1, rows.length - 1)]?.id ?? null, true); },
      k: (e) => { e.preventDefault(); k.go(rows[Math.max(index - 1, 0)]?.id ?? null, true); },
      enter: intoDetail,
      l: intoDetail,
      arrowright: intoDetail,
      escape: outOfDetail(true),
      arrowleft: outOfDetail(false),
      A: () => k.selectAll(),
      "/": (e) => { e.preventDefault(); k.focusSearch(); },
      x: () => d && k.toggleSelect(d.id),
      t: () => k.toggleThread(),
      u: () => (k.undoLast ? k.undoLast() : actions.undoKey(d)),
      c: act(k.toggleChecked),
      r: act(k.replyAll),
      d: act((x) => { k.advance(x); actions.setStatus(x, "done"); }),
      s: act((x) => { k.advance(x); actions.setStatus(x, "skipped"); }),
      h: act((x) => actions.setStatus(x, x.status === "hold" ? "ready" : "hold")),
      1: tone(0),
      2: tone(1),
      3: tone(2),
    },
    k.enabled,
    REVIEW_KEYS,
  );
}
