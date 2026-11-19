import { FOCUS_SELECTED_MAX, type FocusPost } from "@hub/contract/focus";
import type { Resolved } from "@/routes/resolve";

/** What this tab shows, as the focus the server keeps (P51). Pure: the publisher hands it the route, the project and the shared state. */
export function deriveFocus(o: { tab: string; route: Resolved; project: string | null; openDraftId: number | null; selected: readonly number[]; visible: boolean }): FocusPost {
  const none: number[] = [];
  const base = { tab: o.tab, project: o.project, visible: o.visible, selected: none };
  const r = o.route;
  switch (r.route) {
    case "drafts.list":
    case "drafts.item": {
      // The card on screen, not the address: a draft id the list does not hold shows the first row (P53).
      const draftId = o.openDraftId ?? (r.route === "drafts.item" ? r.params.id : undefined);
      return {
        ...base,
        screen: r.route === "drafts.item" ? "draft" : r.search.filter === "sequences" ? "follow-ups" : "drafts",
        ...(draftId ? { draftId } : {}),
        selected: o.selected.slice(0, FOCUS_SELECTED_MAX),
        view: r.search.filter,
        ...(r.search.q ? { q: r.search.q.slice(0, 200) } : {}),
      };
    }
    case "log.list":
      return { ...base, screen: r.search.run ? "run" : "activity", ...(r.search.run ? { runId: r.search.run } : {}) };
    // P70: the project's Settings panes keep the focus word of the Project screen they replaced; the instance's say "connections".
    case "settings.page":
    case "settings.mail":
    case "settings.agent":
      return { ...base, screen: "project" };
    case "settings.connections":
    case "settings.mac":
      return { ...base, project: null, screen: "connections" };
    case "overview.page":
      return { ...base, project: null, screen: "overview" };
    default:
      return { ...base, screen: "other" };
  }
}

/** Two focuses say the same (the heartbeat re-posts an unchanged one; a change posts at once after the debounce). */
export const sameFocus = (a: FocusPost | null, b: FocusPost | null): boolean => JSON.stringify(a) === JSON.stringify(b);
