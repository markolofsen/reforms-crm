import { useHotkeys } from "@hub/ui/use-hotkey";
import { popupOpen } from "@/components/conversation/list/keys";

/** P138 verdict 5: the Leads list keys (the `?` popover lists them while the page is on screen). */
export const LEAD_LIST_KEYS: readonly (readonly [string, string])[] = [
  ["J / K", "next / previous lead"],
  ["Enter", "open the lead: its first action"],
];

/** The open lead's action keys. */
export const LEAD_ACTION_KEYS: readonly (readonly [string, string])[] = [
  ["R", "prepare reply (pastes the request into the dock)"],
  ["N", "not now"],
  ["S", "spam"],
];

const enabled = () => !popupOpen();

/** The row link of a lead (rows carry `data-lead`). */
export const focusLeadRow = (pageId: string) =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-lead="${globalThis.CSS?.escape?.(pageId) ?? pageId}"] a`)?.focus());

/** Focus the open lead's first action: Prepare reply, else its first control. */
export const focusLeadCard = () =>
  requestAnimationFrame(() => {
    const card = document.querySelector('[data-testid="lead-card"]');
    (card?.querySelector<HTMLElement>('[data-variant="primary"]:not(:disabled)') ?? card?.querySelector<HTMLElement>("button:not(:disabled), a[href]"))?.focus();
  });

/** J / K move between the rows (the lead opens, focus on its row); Enter from the list or nowhere goes into the card. */
export function useLeadListKeys(k: { ids: readonly string[]; currentId: string | null; open: (pageId: string) => void }): void {
  const index = k.currentId === null ? -1 : k.ids.indexOf(k.currentId);
  const move = (step: number) => (e: { preventDefault: () => void }) => {
    const next = k.ids[Math.min(Math.max(index + step, 0), k.ids.length - 1)];
    if (next === undefined) return;
    e.preventDefault();
    k.open(next);
    focusLeadRow(next);
  };
  const fromList = () => {
    const el = document.activeElement;
    return el === null || el === document.body || (el.closest('[data-pane="list"]') !== null && el.closest("[data-lead]") === null && el.closest("button, a[href], [role=radio]") === null);
  };
  useHotkeys(
    {
      j: move(1),
      k: move(-1),
      enter: (e) => {
        if (k.currentId === null || !fromList()) return;
        e.preventDefault();
        focusLeadCard();
      },
    },
    enabled,
    LEAD_LIST_KEYS,
  );
}

/** R, N, S on the open lead; a null action is not offered (a closed lead, a pending change, no email). */
export function useLeadActionKeys(a: { prepare: (() => void) | null; notNow: (() => void) | null; spam: (() => void) | null }): void {
  useHotkeys({ r: () => a.prepare?.(), n: () => a.notNow?.(), s: () => a.spam?.() }, enabled, LEAD_ACTION_KEYS);
}
