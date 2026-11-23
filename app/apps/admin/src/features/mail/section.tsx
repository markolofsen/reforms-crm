"use client";

import { clientKey } from "@hub/contract/client-key";
import type { SearchFor } from "@/routes/table";
import { NoSuchClient } from "./no-such-client";
import { useClientKey } from "./use-client-key";
import { phrase } from "@hub/contract/help";
import { useCallback, useMemo } from "react";
import { ReviewWorkspace } from "@/features/mail/list/workspace";
import type { View } from "@/features/mail/list/header";
import { useDebounced } from "@/hooks/use-debounced";
import { useGo } from "@/hooks/use-go";
import { usePaneMeasured, usePaneNarrow } from "@/hooks/use-pane";
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
/** A batch is chosen from the View menu like a view; its value carries the id. */
const BATCH = "batch:";


/**
 * P128 X0 (F5): the rail's Mail badge is the Needs you count of the very query Mail's default list reads (same key, same loader;
 * the counts do not depend on the view or the search), so the badge and Mail ▸ Needs you never disagree.
 */
/** The three views of Mail as its sidebar children (P103 with P104, decision 0045 point 21), each with its count from the same query. */
export type MailViewItem = { id: "needs_you" | "waiting" | "all"; title: string; to: Dest; count: number; active: boolean };

/**
 * Mail's sidebar submenu (P104's scope, P125 verdict 12): Needs you · Waiting · All with the counts of the Needs you reply (it
 * carries every view's count), the one on screen marked. The filters (Follow-ups, Not by email) and batches stay in the list
 * header's View menu, which is also the list's title (P128 X4): sidebar = where, header = which subset.
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

type Props = { project: string; filter: DraftView; q: string; batch: number | null; clientId: number | null; pointed: string | null; leadPageId: string | null; mobile: boolean; measured: boolean };

/** Mail: the list column (View menu, status line, people) and the open conversation. The view, the search, the batch and the person live in the address. */
function MailSection({ project, filter, q, batch, clientId, pointed, leadPageId, mobile, measured }: Props) {
  const go = useGo();
  // P103: a row knows its client id; `id-<n>` opens it and `useClientKey` replaces the address with his email key.
  const onAuto = useCallback((id: number) => go(dest("mail.conversation", { key: clientKey({ id }) }, { filter, q, batch }), { replace: true }), [go, filter, q, batch]);
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
  const views = (counts: ReviewPage["counts"]): View[] => [
    ...DRAFT_VIEWS.map((v) => ({ value: v, label: DRAFT_VIEW_LABELS[v], count: v === "not_by_email" ? notByEmail : countOf(counts, v), ...(DRAFT_FILTERS.has(v) ? { group: "Filters" } : {}) })),
    ...(batches.data?.batches ?? []).map((b) => ({ value: `${BATCH}${b.id}`, label: b.name, count: b.total, group: "Batches" })),
  ];
  // The View menu's value is the batch when one is open, else the view.
  const onView = (v: string) =>
    v.startsWith(BATCH) ? go(dest("mail.list", { filter: "all", batch: Number(v.slice(BATCH.length)) }), { replace: true }) : go(dest("mail.list", { filter: DRAFT_VIEWS.find((x) => x === v) ?? "needs_you", q }), { replace: true });
  // P97, P99 verdict 8: a lead is not a conversation until the first reply is sent: New leads stay a group below the people.
  const leads = batch === null && (filter === "needs_you" || filter === "all") && inbound.data?.leads ? <LeadsGroup group={inbound.data.leads} openPageId={leadPageId} /> : undefined;
  return (
    <ReviewWorkspace
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
      measured={measured}
      mobile={mobile}
      noun={{ list: "Mail", back: "Mail" }}
      onView={onView}
      pointed={pointed}
      search={[q, setQ]}
      // The first pick from the list pushes (Back returns to the list); moving between people replaces; the person the screen
      // opens by itself on a wide pane replaces too (P53), so the address always names the conversation on screen.
      rowTo={(r) => dest("mail.conversation", { key: clientKey({ id: r.client.id, email: r.client.email }) }, { filter, q, batch })}
      selection={{ id: clientId, onChange: (id) => go(id === null ? dest("mail.list", { filter, q, batch }) : dest("mail.conversation", { key: clientKey({ id }) }, { filter, q, batch }), { replace: clientId !== null }), onAuto }}
      source={{ ...source, filter: batch === null ? filter : `${BATCH}${batch}` }}
      status={<StatusLine project={project} />}
      views={views}
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
  // A pane too narrow for the split (a phone, or the terminal docked beside it) shows the list and the conversation as separate screens.
  const compact = usePaneNarrow();
  const measured = usePaneMeasured();
  if (route.route !== "mail.list" && route.route !== "mail.conversation" && route.route !== "mail.lead") return null;
  const leadPageId = route.route === "mail.lead" ? route.params.page : null;
  const { q, batch, filter } = route.search;
  return <KeyedMail compact={compact} leadPageId={leadPageId} measured={measured} pointed={route.search.m ?? null} project={project} routeKey={route.route === "mail.conversation" ? route.params.key : null} search={route.search} />;
}

/** P103: the address's client key to his row id, then the Mail section; a key nobody has is "No such client", not a blank pane. */
function KeyedMail({ project, routeKey, search, leadPageId, measured, compact, pointed }: { project: string; routeKey: string | null; search: SearchFor<"mail.conversation">; leadPageId: string | null; measured: boolean; compact: boolean; pointed: string | null }) {
  const client = useClientKey(project, routeKey, search);
  const { q, batch, filter } = search;
  if (client.missing) return <NoSuchClient />;
  const clientId = client.id;
  return <MailSection batch={batch} clientId={clientId} filter={filter} leadPageId={leadPageId} measured={measured} mobile={compact} pointed={pointed} project={project} q={q} />;
}
