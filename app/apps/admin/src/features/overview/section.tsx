"use client";

import { PaneScroll } from "@/features/shell/split-view";
import { useRoute } from "@/hooks/use-route";
import { OverviewView } from "./overview-view";

/** The Overview screen: a full-width page, not a list and a card. The only one that is about every project (its address names none). */
export function OverviewScreen() {
  const route = useRoute();
  if (route.route !== "overview.page") return null;
  return (
    <PaneScroll className="max-w-6xl pt-0 sm:pt-0">
      <OverviewView focus={route.search.focus} />
    </PaneScroll>
  );
}
