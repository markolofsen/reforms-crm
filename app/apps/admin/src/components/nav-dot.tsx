import { useMemo } from "react";
import { dotOf, useNeedsYouPlaces, useProjectRow } from "@/lib/data/overview";
import { useAgentToolsNeedYou } from "@/lib/data/project";
import { NEXT_ROUTE } from "@/routes/sections";
import type { RouteId } from "@/routes/table";

/**
 * The pages that need the owner, one set for the nav and the sub-nav: the page that fixes the project's worst fact
 * (`statusDto.next`), Settings ▸ Agent while an Agent tools row needs a fix or a look, and every place Overview's "Needs you" names
 * (UX pass: one source of attention). The sidebar lights a section from it, the sub-nav a pane (P75).
 */
export function useLitRoutes(project: string | null): ReadonlySet<RouteId> {
  const { row } = useProjectRow(project ?? "");
  // P134 verdict 12: a worst fact whose place is Overview is Overview's body, not a rail dot (the Settings pane that fixes it has one).
  const worst = dotOf(row?.status);
  const next = worst === "overview" ? null : worst;
  const tools = useAgentToolsNeedYou(project);
  const places = useNeedsYouPlaces(project);
  return useMemo(() => new Set<RouteId>([...(next ? [NEXT_ROUTE[next]] : []), ...(tools ? (["settings.agent"] as const) : []), ...places.map((p) => NEXT_ROUTE[p])]), [next, tools, places]);
}

const AT = {
  /** A sidebar entry: at its end, and on the rail on the icon's corner. */
  rail: "ms-auto flex items-center group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:end-1.5 group-data-[collapsible=icon]:top-1.5",
  /** A sub-nav tab or menu item: before its label, so the label ends the name (as on the phone bar). */
  lead: "flex items-center",
} as const;

/** The "needs you" dot of a nav entry or a sub-nav tab: a colour and the words for a screen reader. */
export function NavDot({ id, at }: { id: string; at: keyof typeof AT }) {
  return (
    <span className={AT[at]} data-testid={`dot-${id}`}>
      <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
      <span className="sr-only">needs you</span>
    </span>
  );
}
