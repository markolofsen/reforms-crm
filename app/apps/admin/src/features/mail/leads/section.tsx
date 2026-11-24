"use client";

import { ArrowLeftIcon } from "lucide-react";
import { LEAD_VIEW_LABELS, type LeadsListDto } from "@hub/contract/inbound";
import { ActionButton } from "@hub/ui/product/action-button";
import { ListDetail, ListScrollArea } from "@hub/ui/product/list/detail";
import { ListToolbar, ListToolbarRow } from "@hub/ui/product/list/toolbar";
import { FilterChips, type Chip } from "@hub/ui/product/list/filter-chips";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, ListState, QueryView, Refreshing } from "@/components/state-views";
import { ListFilterButton } from "@/features/mail/list/filter-menu";
import { useGo } from "@/hooks/use-go";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useClock } from "@/lib/clock";
import { useLeads } from "@/lib/data/inbound";
import { dest } from "@/routes/paths";
import { LEAD_VIEWS, type LeadView } from "@/routes/search";
import { newestOf } from "./groups";
import { useLeadListKeys } from "./keys";
import { LeadCard } from "./lead-card";
import { LeadRows, LeadsReadLine } from "./rows";
import { useLeadsSeen } from "./use-seen";

const EMPTY: Record<LeadView, string> = { new: "No new lead", not_now: "Nothing put aside", spam: "No spam", replied: "No lead answered yet" };

/**
 * P138 verdict 7: the views of Leads as one segmented control in the list header (New, Not now, Spam, Replied with their counts),
 * not a menu column: the sidebar's Leads stays the one door to the page. Replied stays hidden while no lead was answered, unless
 * it is on screen. A choice replaces the history entry (`?view=`), like any filter.
 */
function ViewChips({ view, counts, onView }: { view: LeadView; counts: LeadsListDto["counts"] | undefined; onView: (v: LeadView) => void }) {
  const chips: Chip<LeadView>[] = LEAD_VIEWS.filter((v) => v !== "replied" || v === view || (counts?.replied ?? 0) > 0).map((v) => ({ value: v, label: LEAD_VIEW_LABELS[v], count: counts?.[v] }));
  return <FilterChips chips={chips} label="Lead views" onChange={onView} value={view} />;
}

type Props = { project: string; view: LeadView; brand: string | null; pageId: string | null };

/**
 * Mail ▸ Leads (P134 verdicts 6-8, P138): a page of its own under Mail, not mixed with the conversations. The views as a segmented
 * control in the list header, every lead of the view (paged, by day) beside the open lead's card, which takes the width the views
 * column had. The view, the brand and the lead live in the address. A lead becomes a Mail conversation on its first reply.
 */
function LeadsPage({ project, view, brand, pageId }: Props) {
  const go = useGo();
  const now = useClock()();
  const { query, rows, head } = useLeads(project, view, brand);
  const list = dest("mail.leads", { view, brand });
  const seen = useLeadsSeen(project, newestOf(rows));
  useLeadListKeys({ ids: rows.map((r) => r.pageId), currentId: pageId, open: (page) => go(dest("mail.lead", { page }, { view, brand })) });
  const title = `Leads${head ? ` · ${head.total}` : ""}`;
  const toolbar = (
    <ListToolbar ariaLabel="Lead filters">
      <ListToolbarRow className="flex-nowrap">
        <h3 className="me-auto min-w-0 truncate font-semibold text-sm" data-testid="list-title">
          {title}
        </h3>
        <ListFilterButton brand={brand} brands={head?.brands ?? []} filter={null} filters={[]} onBrand={(b) => go(dest("mail.leads", { view, brand: b }), { replace: true })} onFilter={() => undefined} what="leads" />
        {query.isFetching && !query.isPending && <Refreshing />}
      </ListToolbarRow>
      <ListToolbarRow>
        <ViewChips counts={head?.counts} onView={(v) => go(dest("mail.leads", { view: v, brand }), { replace: true })} view={view} />
      </ListToolbarRow>
    </ListToolbar>
  );
  const listColumn = (
    <ListScrollArea ariaBusy={query.isFetching && !query.isPending}>
      {toolbar}
      <QueryView frame={(note) => <ListState>{note}</ListState>} loading={<ListSkeleton label="Loading the leads" />} query={query} what="the leads">
        {() => (
          <>
            {rows.length === 0 ? (
              <EmptyState compact title={EMPTY[view]}>
                {brand ? `No lead of ${brand} in this view.` : view === "new" ? "A lead a site’s form sent appears here once Notion Leads are read." : undefined}
              </EmptyState>
            ) : (
              <LeadRows now={now} openPageId={pageId} rowTo={(page) => dest("mail.lead", { page }, { view, brand })} rows={rows} seen={seen} />
            )}
            {query.hasNextPage && (
              <div className="flex flex-wrap items-center gap-3 border-t p-3">
                <p className="text-muted-foreground text-xs tabular-nums">
                  {rows.length} of {head?.total ?? rows.length} loaded
                </p>
                <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} size="s" variant="secondary">
                  {query.isFetchingNextPage ? "Loading" : "Load more"}
                </ActionButton>
              </div>
            )}
            {head && <LeadsReadLine now={now} older={view === "new"} read={head.read} />}
          </>
        )}
      </QueryView>
    </ListScrollArea>
  );
  const detail =
    pageId === null ? (
      <div className="p-3 lg:p-4">
        <EmptyState compact title="Nothing to open">
          Pick a lead from the list.
        </EmptyState>
      </div>
    ) : (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]" data-pane="aside">
        {/* One pane at a time below the split (a container query, never a width branch): the way back to the list. */}
        <div className="border-b p-2 @3xl:hidden">
          <AppLink bare className="inline-flex min-h-(--control-m) items-center gap-2 px-2 text-sm" to={list}>
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            Leads
          </AppLink>
        </div>
        <LeadCard key={pageId} onClosed={() => go(list, { replace: true })} pageId={pageId} project={project} />
      </div>
    );
  return <ListDetail detail={detail} detailLabel="Lead" list={listColumn} listLabel="Leads" showDetail={pageId !== null} />;
}

/** The Leads screen, mounted by `mail/leads/layout.tsx`: the view, the brand and the open lead from the address. */
export function LeadsScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  if (route.route !== "mail.leads" && route.route !== "mail.lead") return null;
  return <LeadsPage brand={route.search.brand} pageId={route.route === "mail.lead" ? route.params.page : null} project={project} view={route.search.view} />;
}
