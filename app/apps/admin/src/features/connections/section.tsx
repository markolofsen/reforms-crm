"use client";

import { PaneScroll } from "@/features/shell/split-view";
import { useRoute } from "@/hooks/use-route";
import { ConnectionsView } from "./connections-view";

/** The Connections screen: the instance's logins and tokens, one page. Like Overview, its address names no project. */
export function ConnectionsScreen() {
  const route = useRoute();
  if (route.route !== "connections.page") return null;
  return (
    <PaneScroll className="max-w-4xl pt-0 sm:pt-0">
      <ConnectionsView />
    </PaneScroll>
  );
}
