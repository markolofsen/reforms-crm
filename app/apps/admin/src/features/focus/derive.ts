import { FOCUS_SELECTED_MAX, FOCUS_WINDOW_MAX, refOf, type FocusPost } from "@hub/contract/focus";
import type { PointerOutcome } from "@hub/contract/pointer";
import { screenTitleOf } from "@/routes/meta";
import { destOf, type Resolved } from "@/routes/resolve";
import { PROJECTLESS } from "@/routes/table";

/** What the screen shares beyond the address (`lib/focus.ts`), as refs. */
export type FocusParts = {
  subject: string | null;
  pointed: string | null;
  selected: readonly string[];
  window: { refs: readonly string[]; total: number } | null;
  pointer: { id: string; outcome: PointerOutcome } | null;
};

/** The record the address itself names: the client of an open conversation (P99), the client Activity is narrowed to (`?client=1`, P73). */
function addressSubject(r: Resolved): string | null {
  // P99 verdict 11: a conversation is `client:<id>`; its focus title names the open draft and their newest message, so the agent
  // never loses its anchor (P98 showed it guessing from "Message 10").
  if (r.route === "mail.conversation") return refOf("client", r.params.id);
  if (r.route === "log.list" && r.search.client) return refOf("client", r.search.client);
  return null;
}

/** The address's search state, defaults left out (as the address writes it); the subject's key (`client`) is not a view. */
function viewOf(r: Resolved): Record<string, string> | undefined {
  const d = destOf(r);
  if (!d) return undefined;
  const v = Object.fromEntries(Object.entries(d.search).filter(([k, x]) => k !== "client" && x !== "").map(([k, x]) => [k, x.slice(0, 200)]));
  return Object.keys(v).length ? v : undefined;
}

/**
 * What this tab shows, as the focus the server keeps (P51, P72 decision 0038). Pure and generic over every route: the route id
 * and the route table's title, the subject (the screen's open card first: P53, the address names the card on screen; else
 * what the address names), the row he is on, the picked rows, the rows on screen and the view. No list of screens: a route
 * added later publishes its id and title by itself (`test/focus.test.ts` runs every route). The projectless routes name no project.
 */
export function deriveFocus(o: { tab: string; route: Resolved; project: string | null; parts: FocusParts; visible: boolean }): FocusPost {
  const r = o.route;
  const subject = o.parts.subject ?? addressSubject(r);
  const view = viewOf(r);
  return {
    tab: o.tab,
    project: r.route !== "notFound" && PROJECTLESS.has(r.route) ? null : o.project,
    route: r.route,
    title: screenTitleOf(r),
    ...(subject ? { subject } : {}),
    ...(o.parts.pointed && o.parts.pointed !== subject ? { pointed: o.parts.pointed } : {}),
    selected: o.parts.selected.slice(0, FOCUS_SELECTED_MAX),
    ...(o.parts.window ? { window: { refs: o.parts.window.refs.slice(0, FOCUS_WINDOW_MAX), total: o.parts.window.total } } : {}),
    ...(view ? { view } : {}),
    ...(o.parts.pointer ? { pointer: o.parts.pointer } : {}),
    visible: o.visible,
  };
}

/** Two focuses say the same (the heartbeat re-posts an unchanged one; a change posts at once after the debounce). */
export const sameFocus = (a: FocusPost | null, b: FocusPost | null): boolean => JSON.stringify(a) === JSON.stringify(b);
