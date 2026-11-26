import type { ReactNode } from "react";
import type { ActivityDto } from "@hub/contract/activity";
import { SectionNav, type SectionNavItem } from "@hub/ui/product/shell/section-nav";
import { AppLink } from "@/components/app-link";
import { dest } from "@/routes/paths";
import { isLogView, type ActivityView } from "@/routes/search";
import { VIEW_LABELS, VIEW_ORDER } from "./labels";
import { ListFilterMenu } from "@hub/ui/product/list/toolbar";
import { useGo } from "@/hooks/use-go";

/**
 * Activity's menu column (P125 L3, it replaces the View menu): the timeline's kinds by outcome with the server's counts, then
 * Follow-ups (P142, the plans of the daily sweep), Sends and Errors under their own heading with its count. Each item is a link (`?kind=`, it pushes: routes rule 9); one client's timeline
 * keeps its `?client=` across the timeline kinds, and Sends and Errors drop it (the send history and the ops log are not per client).
 */
export function KindNav({ value, client, counts, sends, errors, followUps }: { value: ActivityView; client: number | null; counts: ActivityDto["counts"] | undefined; sends: number | undefined; errors: number | undefined; followUps?: number | undefined }) {
  const go = useGo();
  const primary: ActivityView[] = ["all", "errors"];
  const items: SectionNavItem[] = primary.map((k) => {
    const current = k === value;
    const to = dest("log.list", { kind: k, client: isLogView(k) ? null : client });
    return {
      id: `kind-${k}`,
      label: VIEW_LABELS[k],
      count: (k === "sends" ? sends : k === "errors" ? errors : k === "follow-ups" ? followUps : counts?.[k]) ?? null,
      current,
      group: isLogView(k) ? "History" : "Decisions",
      render: (content: ReactNode, className: string) => (
        <AppLink aria-current={current ? "page" : undefined} bare className={className} to={to}>
          {content}
        </AppLink>
      ),
    };
  });
  return <div className="flex flex-col gap-3"><SectionNav items={items} label="Activity kinds" /><ListFilterMenu name="Activity filter" options={VIEW_ORDER.map((k) => ({ value: k, label: VIEW_LABELS[k], count: k === "sends" ? sends : k === "errors" ? errors : k === "follow-ups" ? followUps : counts?.[k] }))} value={value} onChange={(v) => { const kind = VIEW_ORDER.find((k) => k === v) ?? "all"; go(dest("log.list", { kind, client: isLogView(kind) ? null : client }), { replace: true }); }} /></div>;
}
