import { useHotkeys } from "@hub/ui/use-hotkey";
import { focusAgentRow } from "@/lib/focus";

/**
 * The list keys of both conversation screens (P127 C2, V9): moving, opening, leaving and search. Each channel adds its own action
 * keys with their `?` rows (Mail: `features/mail/list/keys.ts`); the `?` popover lists what registers on the screen.
 */
export const LIST_KEYS: readonly (readonly [string, string])[] = [
  ["J / K", "next / previous conversation"],
  ["Enter, L, Right", "into the conversation: its unsent message's main action"],
  ["Esc, Left", "back to the list; clears a selection first"],
  ["/", "search"],
];

/** Only when the channel has a selection (Mail). */
export const SELECTION_KEYS: readonly (readonly [string, string])[] = [
  ["X", "select or unselect the person"],
  ["Shift A", "select every person with an open draft"],
];

const inside = (el: Element | null, pane: string) => el?.closest(`[data-pane="${pane}"]`) != null;
// A tooltip is not a popup that owns Esc (a focused control's hint, such as Open draft in Mail's, must not keep Esc in the card).
export const popupOpen = () => document.querySelector('[data-slot$="-popup"]:not([data-slot="tooltip-popup"]), [role="dialog"], [role="menu"]') !== null;
const tooltipOpen = () => document.querySelector('[data-slot="tooltip-popup"]') !== null;

/** Focus a row's link once it has rendered: after Done or Skip the card that held focus is gone, so focus follows to the next one. */
export function focusRow(ref: string | null): void {
  if (ref === null) return;
  requestAnimationFrame(() => focusAgentRow(ref));
}

/** Focus the first thing to do in the open pane: its primary action, else its first control. */
export function focusDetail(): void {
  requestAnimationFrame(() => {
    const pane = document.querySelector('[data-pane="detail"]');
    const target = pane?.querySelector<HTMLElement>('[data-variant="primary"]:not(:disabled)') ?? pane?.querySelector<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled)");
    target?.focus();
  });
}

export type ListKeyDeps = {
  enabled: () => boolean;
  /** The list's rows in order and the open one. */
  ids: readonly number[];
  currentId: number | null;
  /** The row's focus ref (`client:7`, `chat:3`): J/K focus it, Esc returns to it. */
  refOf: (id: number) => string;
  go: (id: number | null, focus?: boolean) => void;
  /** Esc on a phone is the Back control. */
  back: (() => void) | null;
  focusSearch: () => void;
  selection?: { count: number; toggle: (id: number) => void; all: () => void; clear: () => void };
};

/** The shared list keys. A channel without `selection` registers no X and Shift A. */
export function useListKeys(k: ListKeyDeps): void {
  const { ids } = k;
  const index = k.currentId === null ? -1 : ids.indexOf(k.currentId);
  // Moving between the panes only starts from the list (or nowhere in particular): a button in the pane keeps its own Enter.
  // A control of the list column that is not a row (New leads, Follow-ups, Not by email, Link a chat) keeps its own Enter too.
  const ownEnter = (el: Element) => el.closest("button, a[href], [role=button]") !== null && el.closest("li[data-agent-ref]") === null;
  const fromList = () => document.activeElement === null || document.activeElement === document.body || (inside(document.activeElement, "list") && !ownEnter(document.activeElement));
  const intoDetail = (e: { preventDefault: () => void }) => {
    if (k.currentId === null || !fromList()) return;
    e.preventDefault();
    focusDetail();
  };
  const outOfDetail = (clears: boolean) => () => {
    if (popupOpen()) return;
    if (clears && k.selection && k.selection.count > 0) k.selection.clear();
    else if (inside(document.activeElement, "detail")) (k.back ?? (() => focusRow(k.currentId === null ? null : k.refOf(k.currentId))))();
  };
  const sel = k.selection;
  useHotkeys(
    {
      j: (e) => { e.preventDefault(); k.go(ids[Math.min(index + 1, ids.length - 1)] ?? null, true); },
      k: (e) => { e.preventDefault(); k.go(ids[Math.max(index - 1, 0)] ?? null, true); },
      enter: intoDetail,
      l: intoDetail,
      arrowright: intoDetail,
      escape: outOfDetail(true),
      arrowleft: outOfDetail(false),
      "/": (e) => { e.preventDefault(); k.focusSearch(); },
      ...(sel ? { A: () => sel.all(), x: () => k.currentId !== null && sel.toggle(k.currentId) } : {}),
    },
    k.enabled,
    sel ? [...LIST_KEYS, ...SELECTION_KEYS] : LIST_KEYS,
  );
  // An open tooltip stops Esc before the keys above (bubble phase) see it: that one case is taken in the capture phase.
  useHotkeys({ escape: () => { if (tooltipOpen()) outOfDetail(false)(); } }, k.enabled, [], { capture: true });
}
