"use client";

import type { SearchFor } from "@/routes/table";
import { NoSuchClient } from "./no-such-client";
import { useClientKey } from "./use-client-key";
import { phrase } from "@hub/contract/help";
import { useCallback, useMemo } from "react";
import { MailWorkspace } from "./adapter";
import { shortBatchName } from "./model";
import type { Filters, View } from "@/features/mail/list/header";
import type { BrandCount } from "@/features/mail/list/filter-menu";
import { useDebounced } from "@/hooks/use-debounced";
import { useGo } from "@/hooks/use-go";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useSearch } from "@/hooks/use-search-state";
import { countOf, mailSource, useBatches, useMailCounts, type ReviewPage } from "@/lib/data/conversations";
import { dest, type Dest } from "@/routes/paths";
import { DRAFT_FILTERS, DRAFT_VIEW_LABELS, DRAFT_VIEWS, MAIL_SEARCH, type DraftView } from "@/routes/search";
import { BatchSend } from "./batch-send";
import { LeadCard } from "./inbox/lead-card";
import { LeadsGroup } from "./inbox/leads-group";
import { useInbound } from "@/lib/data/inbound";
import { NotByEmail, useNotByEmailTotal } from "./not-by-email";
import { FollowUps } from "./sequences/follow-ups";
import { StatusLine } from "./status-line";

// P99 (verdict 3): Mail lists people. Needs you (they wrote, or a draft is ready) is the default, then Waiting and All; Follow-ups
// and Not by email are filters of All under their own heading. The old views (To review, Hold, Thin basis, Sent, Finished, Inbox)
// are state words and chips on a row.
const EMPTY: Record<DraftView, string> = { needs_you: "Nobody needs you", waiting: "Nobody to wait for", all: "No conversation yet", sequences: "No follow-up step to review", not_by_email: "Nobody" };
const SEARCH_PAUSE_MS = 250;
/** A batch on screen (`?batch=`) is the list's title like a view; its value carries the id. */
const BATCH = "batch:";
/** The sidebar's three views (P134 verdict 1): a phone's View menu offers the same three. */
const SIDEBAR_VIEWS = ["needs_you", "waiting", "all"] as const;


/**
 * P128 X0 (F5): the rail's Mail badge is the Needs you count of the very query Mail's default list reads (same key, same loader;
 * the counts do not depend on the view or the search), so the badge and Mail ▸ Needs you never disagree.
 */
/** The three views of Mail as its sidebar children (P103 with P104, decision 0045 point 21), each with its count from the same query. */
export type MailViewItem = { id: "needs_you" | "waiting" | "all"; title: string; to: Dest; count: number; active: boolean };

/**
 * Mail's sidebar submenu (P104's scope, P125 verdict 12): Needs you · Waiting · All with the counts of the Needs you reply (it
 * carries every view's count), the one on screen marked. P134 verdict 1: it is the one door to a view; the list's header only
 * names the view on screen, and the filters of All (Follow-ups, Not by email) sit in its filter button.
 */
export function useMailViews(project: string | null): MailViewItem[] {
  const route = useRoute();
  const counts = useMailCounts(project);
  const here = route.route === "mail.list" || route.route === "mail.conversation" ? (route.search.batch === null ? route.search.filter : null) : null;
  return (["needs_you", "waiting", "all"] as const).map((v) => ({ id: v, title: DRAFT_VIEW_LABELS[v], to: dest("mail.list", { filter: v }), count: countOf(counts, v) ?? 0, active: here === v }));
}

export function useMailNeedsYou(project: string | null): number {
  const counts = useMailCounts(project);
  return project === null ? 0 : (countOf(counts, "needs_you") ?? 0);
}

type Props = { project: string; filter: DraftView; q: string; batch: number | null; clientId: number | null; pending: boolean; pointed: string | null; leadPageId: string | null };

/** Mail: the list column (title, status line, people) and the open conversation. The view, the search, the batch and the person live in the address. */
function MailSection({ project, filter, q, batch, clientId, pending, pointed, leadPageId }: Props) {
  const go = useGo();
  const [, setSearch] = useSearch(MAIL_SEARCH);
  const setQ = useCallback((v: string) => setSearch({ q: v }), [setSearch]);
  const search = useDebounced(q.trim(), SEARCH_PAUSE_MS);
  const batches = useBatches(project);
  const notByEmail = useNotByEmailTotal(project);
  const inbound = useInbound(project);
  const known = batch === null || (batches.data?.batches.some((b) => b.id === batch) ?? true);
  const current = batch === null ? undefined : batches.data?.batches.find((b) => b.id === batch);
  // Not by email lists client rows, not conversations: the list query still runs (as All) so the View menu keeps every count.
  const source = useMemo(() => mailSource(project, filter, filter === "not_by_email" ? "all" : filter, { search, batch }), [project, filter, batch, search]);
  const countFor = (counts: ReviewPage["counts"], v: DraftView) => (v === "not_by_email" ? notByEmail : countOf(counts, v));
  // The title names the view on screen: one of the sidebar's three, a filter of All, or the batch a link opened (P134 verdict 2: no batch list).
  const header = (counts: ReviewPage["counts"], brands: readonly BrandCount[]): { views: View[]; filters: Filters } => ({
    views: [
      ...DRAFT_VIEWS.filter((v) => !DRAFT_FILTERS.has(v) || v === filter).map((v) => ({ value: v, label: DRAFT_VIEW_LABELS[v], count: countFor(counts, v) })),
      ...(current ? [{ value: `${BATCH}${current.id}`, label: shortBatchName(current.name), count: current.total }] : []),
    ],
    filters: {
      options: DRAFT_VIEWS.filter((v) => DRAFT_FILTERS.has(v)).map((v) => ({ value: v, label: DRAFT_VIEW_LABELS[v], count: countFor(counts, v) })),
      value: DRAFT_FILTERS.has(filter) && batch === null ? filter : null,
      onChange: (v) => go(dest("mail.list", { filter: DRAFT_VIEWS.find((x) => x === v) ?? "all", q }), { replace: true }),
      brands,
      brand: null,
      onBrand: () => undefined,
    },
  });
  const onView = (v: string) => go(dest("mail.list", { filter: SIDEBAR_VIEWS.find((x) => x === v) ?? "needs_you", q }), { replace: true });
  // P97, P99 verdict 8: a lead is not a conversation until the first reply is sent: New leads stay a group below the people.
  const leads = batch === null && (filter === "needs_you" || filter === "all") && inbound.data?.leads ? <LeadsGroup group={inbound.data.leads} openPageId={leadPageId} /> : undefined;
  return (
    <MailWorkspace
      aside={leadPageId !== null ? { open: true, node: <LeadCard key={leadPageId} onClosed={() => go(dest("mail.list", { filter }), { replace: true })} pageId={leadPageId} project={project} /> } : undefined}
      body={filter === "not_by_email" ? <NotByEmail project={project} /> : undefined}
      empty={(filtered) =>
        !known
          ? "That batch is not in this project."
          : batch !== null
            ? `${EMPTY[filter]} in this batch.`
            : filtered
              ? null
              : `Say to the agent: “${phrase("triage-mail", project)}”. The people it answers appear here, with their whole correspondence.`
      }
      emptyTitle={known && batch === null ? EMPTY[filter] : undefined}
      listBottom={
        batch !== null && known ? (
          // P85b: a batch's own Send all Checked; every draft still has its own Send at the bottom of its conversation.
          <BatchSend batchId={batch} brief={current?.brief ?? null} checked={current?.counts.checked ?? 0} project={project} />
        ) : filter === "sequences" ? (
          <FollowUps project={project} />
        ) : (
          leads
        )
      }
      clientId={clientId}
      pending={pending}
      onView={onView}
      pointed={pointed}
      search={[q, setQ]}
      place={{ filter, q, batch }}
      source={{ ...source, filter: batch === null ? filter : `${BATCH}${batch}` }}
      status={<StatusLine project={project} />}
      header={header}
    />
  );
}

/**
 * The Mail screen, the home of every instance, mounted by `mail/layout.tsx` so the list survives opening and closing a
 * conversation. It reads the address (the view, the search, the batch, the person, a lead) and the project scope; for any other
 * address (Not found under /mail) it renders nothing and the route's own page shows.
 */
export function MailScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  if (route.route !== "mail.list" && route.route !== "mail.conversation" && route.route !== "mail.lead") return null;
  const leadPageId = route.route === "mail.lead" ? route.params.page : null;
  return <KeyedMail leadPageId={leadPageId} pointed={route.search.m ?? null} project={project} routeKey={route.route === "mail.conversation" ? route.params.key : null} search={route.search} />;
}

/** P103: the address's client key to his row id, then the Mail section; a key nobody has is "No such client", not a blank pane. */
function KeyedMail({ project, routeKey, search, leadPageId, pointed }: { project: string; routeKey: string | null; search: SearchFor<"mail.conversation">; leadPageId: string | null; pointed: string | null }) {
  const client = useClientKey(project, routeKey, search);
  const { q, batch, filter } = search;
  if (client.missing) return <NoSuchClient />;
  const clientId = client.id;
  // An email key the server has not answered yet: the address names someone, so the wide pane must not open the first row.
  const pending = routeKey !== null && clientId === null;
  return <MailSection batch={batch} clientId={clientId} pending={pending} filter={filter} leadPageId={leadPageId} pointed={pointed} project={project} q={q} />;
}
