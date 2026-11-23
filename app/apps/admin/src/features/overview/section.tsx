"use client";

import { Page } from "@hub/ui/product/page";
import { useRoute } from "@/hooks/use-route";
import { OverviewView } from "./overview-view";

/** The Overview screen: one full-width page about the whole Hub and every project (its address names none), on every instance (P63). */
export function OverviewScreen() {
  if (!useRoute("overview.page")) return null;
  return (
    <Page>
      <OverviewView />
    </Page>
  );
}
