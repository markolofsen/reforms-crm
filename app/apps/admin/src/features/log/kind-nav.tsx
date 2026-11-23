import type { ReactNode } from "react";
import type { ActivityDto } from "@hub/contract/activity";
import { SectionNav, type SectionNavItem } from "@hub/ui/product/shell/section-nav";
import { AppLink } from "@/components/app-link";
import { dest } from "@/routes/paths";
import type { ActivityView } from "@/routes/search";
import { VIEW_LABELS, VIEW_ORDER } from "./labels";

/**
 * Activity's menu column (P125 L3, it replaces the View menu): the timeline's kinds by outcome with the server's counts, then
 * Sends under its own heading with its count. Each item is a link (`?kind=`, it pushes: routes rule 9); one client's timeline
 * keeps its `?client=` across the timeline kinds, and Sends drops it (the send history is not per client).
 */
export function KindNav({ value, client, counts, sends }: { value: ActivityView; client: number | null; counts: ActivityDto["counts"] | undefined; sends: number | undefined }) {
  const items: SectionNavItem[] = VIEW_ORDER.map((k) => {
    const current = k === value;
    const to = dest("log.list", { kind: k, client: k === "sends" ? null : client });
    return {
      id: `kind-${k}`,
      label: VIEW_LABELS[k],
      count: (k === "sends" ? sends : counts?.[k]) ?? null,
      current,
      group: k === "sends" ? "History" : "Decisions",
      render: (content: ReactNode, className: string) => (
        <AppLink aria-current={current ? "page" : undefined} bare className={className} to={to}>
          {content}
        </AppLink>
      ),
    };
  });
  return <SectionNav items={items} label="Activity kinds" />;
}
