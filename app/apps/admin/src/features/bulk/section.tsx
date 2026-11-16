"use client";

import { PaneScroll } from "@/features/shell/split-view";
import { PhoneProjectSwitcher } from "@/features/shell/project-switcher";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { BatchList } from "./batch-list";
import { BatchSection } from "./batch-section";
import { NewBatch } from "./new-batch";

/**
 * The Bulk screen, mounted by `bulk/page.tsx` and `bulk/[id]/page.tsx`: the batch list or the new-batch form on one scrolling
 * page (`?new=1`), or one batch as a review workspace. It reads the address and the project scope; any other route renders nothing.
 */
export function BulkScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  // Below 1024px the list and its detail are separate screens (a tablet keeps the rail, a phone gets the tab bar).
  const compact = useMediaQuery("max-lg");
  if (route.route === "bulk.item") return <BatchSection batchId={route.params.id} filter={route.search.filter} key={`${project}:${route.params.id}`} mobile={compact} project={project} />;
  if (route.route !== "bulk.list") return null;
  return (
    <PaneScroll>
      <PhoneProjectSwitcher />
      {route.search.new ? <NewBatch key={project} project={project} /> : <BatchList project={project} />}
    </PaneScroll>
  );
}
