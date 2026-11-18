"use client";

import { Page } from "@hub/ui/product/page";
import { useRoute } from "@/hooks/use-route";
import { OverviewView } from "./overview-view";

/** The Overview screen: one full-width page about every project (its address names none). Only an instance with two or more projects reaches it. */
export function OverviewScreen() {
  const route = useRoute();
  if (route.route !== "overview.page") return null;
  return (
    <Page>
      <OverviewView />
    </Page>
  );
}
