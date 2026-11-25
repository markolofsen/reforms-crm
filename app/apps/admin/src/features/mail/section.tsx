"use client";

import type { SearchFor } from "@/routes/table";
import { NoSuchClient } from "./no-such-client";
import { useClientKey } from "./use-client-key";
import { phrase } from "@hub/contract/help";
import { useCallback, useMemo } from "react";
import { MailWorkspace } from "./adapter";
import { batchAwaiting, shortBatchName } from "./model";
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
import { BatchLine, BatchSend } from "./batch-send";
import { useNewLeads } from "@/lib/data/inbound";
import { NotByEmail, useNotByEmailTotal } from "./not-by-email";
import { FollowUps } from "./sequences/follow-ups";
import { StatusLine } from "./status-line";

// P134 verdict 6: leads are Mail ▸ Leads, a page of their own (`features/mail/leads`); Mail's views list conversations only.
// P99 (verdict 3): Mail lists people. Needs you (they wrote, or a draft is ready) is the default, then Waiting and All; Follow-ups
// and Not by email are filters of All under their own heading. The old views (To review, Hold, Thin basis, Sent, Finished, Inbox)
// are state words and chips on a row.
const EMPTY: Record<DraftView, string> = { needs_you: "Nobody needs you", waiting: "Nobody to wait for", all: "No conversation yet", sequences: "No sequence step to review", not_by_email: "Nobody" };
const SEARCH_PAUSE_MS = 250;
/** A batch on screen (`?batch=`) is the list's title like a view; its value carries the id. */
const BATCH = "batch:";
/** The sidebar's three views (P134 verdict 1): a phone's View menu offers the same three. */
const SIDEBAR_VIEWS = ["needs_you", "waiting", "all"] as const;
const LEADS = "leads";


/**
 * P128 X0 (F5): the rail's Mail badge is the Needs you count of the very query Mail's default list reads (same key, same loader;
 * the counts do not depend on the view or the search), so the badge and Mail ▸ Needs you never disagree.
 */
/** The three views of Mail as its sidebar children (P103 with P104, decision 0045 point 21), each with its count from the same query. */
export type MailViewItem = { id: "needs_you" | "waiting" | "all" | "leads"; title: string; to: Dest; count: number; active: boolean };

/**
 * Mail's sidebar submenu (P104's scope, P125 verdict 12): Needs you · Waiting · All with the counts of the Needs you reply (it
 * carries every view's count), the one on screen marked. P134 verdict 1: it is the one door to a view; the list's header only
 * names the view on screen, and the filters of All (Sequence steps, Not by email) sit in its filter button.
 */
export function useMailViews(project: string | null): MailViewItem[] {
  const route = useRoute();
  const counts = useMailCounts(project);
  const leads = useNewLeads(project);
  const here = route.route === "mail.list" || route.route === "mail.conversation" ? (route.search.batch === null ? route.search.filter : null) : null;
  const onLeads = route.route === "mail.leads" || route.route === "mail.lead";
  return [
    ...(["needs_you", "waiting", "all"] as const).map((v) => ({ id: v, title: DRAFT_VIEW_LABELS[v], to: dest("mail.list", { filter: v }), count: countOf(counts, v) ?? 0, active: here === v })),
    // P134 verdict 6: Leads, a page of its own under Mail, with the count of new leads.
    { id: "leads" as const, title: "Leads", to: dest("mail.leads"), count: leads, active: onLeads },
  ];
}

export function useMailNeedsYou(project: string | null): number {
  const counts = useMailCounts(project);
  return project === null ? 0 : (countOf(counts, "needs_you") ?? 0);
}

type Props = { project: string; filter: DraftView; q: string; batch: number | null; brand: string | null; clientId: number | null; pending: boolean; pointed: string | null };

/** Mail: the list column (title, status line, people) and the open conversation. The view, the search, the batch and the person live in the address. */
function MailSection({ project, filter, q, batch, brand, clientId, pending, pointed }: Props) {
  const go = useGo();
  const [, setSearch] = useSearch(MAIL_SEARCH);
  const setQ = useCallback((v: string) => setSearch({ q: v }), [setSearch]);
  const setBrand = useCallback((b: string | null) => setSearch({ brand: b }), [setSearch]);
  const search = useDebounced(q.trim(), SEARCH_PAUSE_MS);
  const batches = useBatches(project);
  const notByEmail = useNotByEmailTotal(project);
  const newLeads = useNewLeads(project);
  const known = batch === null || (batches.data?.batches.some((b) => b.id === batch) ?? true);
  const current = batch === null ? undefined : batches.data?.batches.find((b) => b.id === batch);
  // Not by email lists client rows, not conversations: the list query still runs (as All) so the View menu keeps every count.
  const source = useMemo(() => mailSource(project, filter, filter === "not_by_email" ? "all" : filter, { search, batch, brand }), [project, filter, batch, search, brand]);
  const countFor = (counts: ReviewPage["counts"], v: DraftView) => (v === "not_by_email" ? notByEmail : countOf(counts, v));
  // The title names the view on screen: one of the sidebar's three, a filter of All, or the batch a link opened (P134 verdict 2: no batch list).
  const header = (counts: ReviewPage["counts"], brands: readonly BrandCount[]): { views: View[]; filters: Filters } => ({
    views: [
      ...DRAFT_VIEWS.filter((v) => !DRAFT_FILTERS.has(v) || v === filter).map((v) => ({ value: v, label: DRAFT_VIEW_LABELS[v], count: countFor(counts, v) })),
      ...(current ? [{ value: `${BATCH}${current.id}`, label: shortBatchName(current.name), count: current.total }] : []),
      // A phone's View menu also leads to Mail ▸ Leads, the sidebar's fourth child (P134 verdict 6).
      { value: LEADS, label: "Leads", count: newLeads },
    ],
    filters: {
      options: DRAFT_VIEWS.filter((v) => DRAFT_FILTERS.has(v)).map((v) => ({ value: v, label: DRAFT_VIEW_LABELS[v], count: countFor(counts, v) })),
      value: DRAFT_FILTERS.has(filter) && batch === null ? filter : null,
      onChange: (v) => go(dest("mail.list", { filter: DRAFT_VIEWS.find((x) => x === v) ?? "all", q, brand }), { replace: true }),
      brands,
      brand,
      onBrand: setBrand,
    },
  });
  const onView = (v: string) => (v === LEADS ? go(dest("mail.leads")) : go(dest("mail.list", { filter: SIDEBAR_VIEWS.find((x) => x === v) ?? "needs_you", q, brand }), { replace: true }));
  // P134 verdict 2: on Needs you, one line per batch whose drafts wait for review; the batch's own list stays a link (`?batch=`).
  const waiting = filter === "needs_you" && batch === null ? (batches.data?.batches ?? []).filter((b) => batchAwaiting(b) > 0) : [];
  const batchLines = waiting.map((b) => (
    <BatchLine awaiting={batchAwaiting(b)} batchId={b.id} checked={b.counts.checked} key={b.id} project={project} request={shortBatchName(b.brief ?? b.name)} to={dest("mail.list", { filter: "all", batch: b.id })} />
  ));
  return (
    <MailWorkspace
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
        ) : undefined
      }
      clientId={clientId}
      pending={pending}
      onView={onView}
      pointed={pointed}
      search={[q, setQ]}
      place={{ filter, q, batch, brand }}
      source={{ ...source, filter: batch === null ? filter : `${BATCH}${batch}` }}
      status={
        <>
          <StatusLine project={project} />
          {batchLines}
        </>
      }
      header={header}
    />
  );
}

/**
 * The Mail screen, the home of every instance, mounted by `mail/layout.tsx` so the list survives opening and closing a
 * conversation. It reads the address (the view, the search, the batch, the brand, the person) and the project scope; for any other
 * address (Leads, P134, or Not found under /mail) it renders nothing and that route's own screen shows.
 */
export function MailScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  if (route.route !== "mail.list" && route.route !== "mail.conversation") return null;
  return <KeyedMail pointed={route.search.m ?? null} project={project} routeKey={route.route === "mail.conversation" ? route.params.key : null} search={route.search} />;
}

/** P103: the address's client key to his row id, then the Mail section; a key nobody has is "No such client", not a blank pane. */
function KeyedMail({ project, routeKey, search, pointed }: { project: string; routeKey: string | null; search: SearchFor<"mail.conversation">; pointed: string | null }) {
  const client = useClientKey(project, routeKey, search);
  const { q, batch, filter, brand } = search;
  if (client.missing) return <NoSuchClient />;
  const clientId = client.id;
  // An email key the server has not answered yet: the address names someone, so the wide pane must not open the first row.
  const pending = routeKey !== null && clientId === null;
  return <MailSection batch={batch} brand={brand} clientId={clientId} pending={pending} filter={filter} pointed={pointed} project={project} q={q} />;
}
