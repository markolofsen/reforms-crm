"use client";

import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { LEAD_VIEW_LABELS, type LeadsListDto } from "@hub/contract/inbound";
import { ActionButton } from "@hub/ui/product/action-button";
import { ListDetail, ListScrollArea } from "@hub/ui/product/list/detail";
import { ListToolbar, ListToolbarRow } from "@hub/ui/product/list/toolbar";
import { SectionLayout } from "@hub/ui/product/shell/section-layout";
import { SectionNav, type SectionNavItem } from "@hub/ui/product/shell/section-nav";
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
import { LeadCard } from "./lead-card";
import { LeadRows, LeadsReadLine } from "./rows";

const EMPTY: Record<LeadView, string> = { new: "No new lead", not_now: "Nothing put aside", spam: "No spam", replied: "No lead answered yet" };

/**
 * The views of Leads as a menu column (P134 verdict 7, like Activity's kinds): New, Not now, Spam and Replied with their counts.
 * Replied stays hidden while no lead was answered (until P97's first sends), unless it is on screen. Each is a link (`?view=`).
 */
function ViewNav({ view, brand, counts }: { view: LeadView; brand: string | null; counts: LeadsListDto["counts"] | undefined }) {
  const items: SectionNavItem[] = LEAD_VIEWS.filter((v) => v !== "replied" || v === view || (counts?.replied ?? 0) > 0).map((v) => ({
    id: `lead-view-${v}`,
    label: LEAD_VIEW_LABELS[v],
    count: counts?.[v] ?? null,
    current: v === view,
    render: (content: ReactNode, className: string) => (
      <AppLink aria-current={v === view ? "page" : undefined} bare className={className} to={dest("mail.leads", { view: v, brand })}>
        {content}
      </AppLink>
    ),
  }));
  return <SectionNav items={items} label="Lead views" />;
}

type Props = { project: string; view: LeadView; brand: string | null; pageId: string | null };

/**
 * Mail ▸ Leads (P134 verdicts 6-8): a page of its own under Mail, not mixed with the conversations. The views in the menu column,
 * then every lead of the view (paged) beside the open lead's card (Prepare reply, Not now, Spam, Open in Notion: P97). The view,
 * the brand and the lead live in the address. A lead becomes a Mail conversation on its first reply.
 */
function LeadsPage({ project, view, brand, pageId }: Props) {
  const go = useGo();
  const now = useClock()();
  const { query, rows, head } = useLeads(project, view, brand);
  const list = dest("mail.leads", { view, brand });
  const title = `${LEAD_VIEW_LABELS[view]}${head ? ` · ${head.total}` : ""}`;
  const toolbar = (
    <ListToolbar ariaLabel="Lead filters">
      <ListToolbarRow className="flex-nowrap">
        <h3 className="me-auto min-w-0 truncate font-semibold text-sm" data-testid="list-title">
          {title}
        </h3>
        <ListFilterButton brand={brand} brands={head?.brands ?? []} filter={null} filters={[]} onBrand={(b) => go(dest("mail.leads", { view, brand: b }), { replace: true })} onFilter={() => undefined} what="leads" />
        {query.isFetching && !query.isPending && <Refreshing />}
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
              <LeadRows now={now} openPageId={pageId} rowTo={(page) => dest("mail.lead", { page }, { view, brand })} rows={rows} />
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
  return (
    <SectionLayout nav={<ViewNav brand={brand} counts={head?.counts} view={view} />} navButton="Views" navLabel="Lead views">
      <ListDetail detail={detail} detailLabel="Lead" list={listColumn} listLabel="Leads" showDetail={pageId !== null} />
    </SectionLayout>
  );
}

/** The Leads screen, mounted by `mail/leads/layout.tsx`: the view, the brand and the open lead from the address. */
export function LeadsScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  if (route.route !== "mail.leads" && route.route !== "mail.lead") return null;
  return <LeadsPage brand={route.search.brand} pageId={route.route === "mail.lead" ? route.params.page : null} project={project} view={route.search.view} />;
}
