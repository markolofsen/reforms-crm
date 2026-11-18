"use client";

import { Page } from "@hub/ui/product/page";
import { useRoute } from "@/hooks/use-route";
import { ConnectionsView } from "./connections-view";

/** The Connections screen: the instance's mail accounts, tokens and bot, one full-width page. Like Overview, its address names no project. */
export function ConnectionsScreen() {
  const route = useRoute();
  if (route.route !== "connections.page") return null;
  return (
    <Page>
      <ConnectionsView />
    </Page>
  );
}
