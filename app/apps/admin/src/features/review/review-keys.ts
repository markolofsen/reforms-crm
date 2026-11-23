import { TONES } from "@hub/config";
import { refOf } from "@hub/contract/focus";
import { useHotkeys } from "@hub/ui/use-hotkey";
import { focusAgentRow } from "@/lib/focus";
import { isClosed, type ReviewDraft } from "./source";
import type { ReviewActions } from "./use-review-actions";

// One key map for both review screens; the `?` popover lists it (the keys register themselves through `useHotkeys`).
export const REVIEW_KEYS: readonly (readonly [string, string])[] = [
  ["J / K", "next / previous conversation"],
  ["Enter, L, Right", "into the conversation: its unsent message's main action"],
  ["Shift Enter", "send: read Mail, then confirm what it shows (the second press counts after a short pause)"],
  ["Esc, Left", "back to the list; clears a selection first"],
  ["C", "I read the checks, on or off (only once the text was read)"],
  ["X", "select or unselect the person"],
  ["Shift A", "select every person with an open draft"],
  ["R", "reply in Mail (batch drafts)"],
  ["D", "done, then the next draft"],
  ["S", "skip, then the next draft"],
  ["H", "hold, or back to ready"],
  ["U", "undo the last Done, Skip or Hold (also on its toast)"],
  ["1 2 3", "short, standard, warm version"],
  ["/", "search"],
];

const inside = (el: Element | null, pane: string) => el?.closest(`[data-pane="${pane}"]`) != null;
const popupOpen = () => document.querySelector('[data-slot$="-popup"], [role="dialog"], [role="menu"]') !== null;

/** Focus a row's button once it has rendered: after Done or Skip the card that held focus is gone, so focus follows to the next person. */
export function focusRow(id: number | null): void {
  if (id === null) return;
  requestAnimationFrame(() => focusAgentRow(refOf("client", id)));
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
  /** P99: the list's people in order (client ids), the open one, and its open draft (the keys that act, act on it). */
  ids: readonly number[];
  currentId: number | null;
  current: ReviewDraft | null;
  actions: ReviewActions;
  go: (id: number | null, focus?: boolean) => void;
  advance: (d: ReviewDraft) => void;
  replyAll: (d: ReviewDraft) => void;
  /** `C`: switch Checked on or off, through the same guard as the switch (it refuses an unreadable draft or one with no text hash). */
  toggleChecked: (d: ReviewDraft) => void;
  undoLast: (() => void) | null;
  toggleSelect: (id: number) => void;
  selectAll: () => void;
  selected: number;
  clearSelection: () => void;
  /** Esc on a phone is the Back control. */
  back: (() => void) | null;
  focusSearch: () => void;
  say: (text: string) => void;
};

/** The shared key map. Closed drafts take no action keys; moving and search remain available. */
export function useReviewKeys(k: KeyDeps): void {
  const { ids, current: d, actions } = k;
  const index = k.currentId === null ? -1 : ids.indexOf(k.currentId);
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
  // A control of the list column that is not a draft row (the New leads, Follow-ups and Not by email blocks) keeps its own Enter too.
  const ownEnter = (el: Element) => el.closest("button, a[href], [role=button]") !== null && el.closest('[id^="person-"]') === null;
  const fromList = () => document.activeElement === null || document.activeElement === document.body || (inside(document.activeElement, "list") && !ownEnter(document.activeElement));
  const intoDetail = (e: { preventDefault: () => void }) => {
    if (k.currentId === null || !fromList()) return;
    e.preventDefault();
    focusDetail();
  };
  const outOfDetail = (clears: boolean) => () => {
    if (popupOpen()) return;
    if (clears && k.selected > 0) k.clearSelection();
    else if (inside(document.activeElement, "detail")) (k.back ?? (() => focusRow(k.currentId)))();
  };
  useHotkeys(
    {
      j: (e) => { e.preventDefault(); k.go(ids[Math.min(index + 1, ids.length - 1)] ?? null, true); },
      k: (e) => { e.preventDefault(); k.go(ids[Math.max(index - 1, 0)] ?? null, true); },
      enter: intoDetail,
      l: intoDetail,
      arrowright: intoDetail,
      escape: outOfDetail(true),
      arrowleft: outOfDetail(false),
      A: () => k.selectAll(),
      "/": (e) => { e.preventDefault(); k.focusSearch(); },
      x: () => k.currentId !== null && k.toggleSelect(k.currentId),
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
