"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ConversationRowDto, ConversationViewDto } from "@hub/contract/conversations";
import { reviewApi } from "@/lib/api/review";
import { keys } from "@/lib/cache/keys";

/**
 * P127 C2's data half (V3): Mail's people, one module (state rule 4b): the list of a view or a batch, the Needs you count the rail
 * and the sidebar read, the batches, a client's key, one conversation and its Mail history and texts. Features read them here and
 * never name a key, a facade or the Query client.
 */

/** One page of the list of people (a view, a batch's people). */
export type ReviewPage = { rows: ConversationRowDto[]; total: number; nextOffset: number | null; counts: Partial<Record<string, number>> };

/** What the review screen needs from the screen that hosts it. It never learns which endpoint answered. */
export type ReviewSource = {
  /** Cache key: the people of this view, per filter. */
  queryKey: readonly unknown[];
  project: string;
  filter: string;
  /** The number a view shows next to its name, from the counts of the first page. */
  countOf: (counts: ReviewPage["counts"], view: string) => number | undefined;
  load: (offset: number) => Promise<ReviewPage>;
  /** A batch can step back its own last action (key U); recorded drafts undo the open draft only. */
  undoLast?: () => Promise<unknown>;
};

type Scope = { search: string; batch: number | null };

const page = async (project: string, view: ConversationViewDto, offset: number, scope: Scope): Promise<ReviewPage> => {
  const r = await reviewApi.conversations(project, view, offset, scope);
  return { rows: r.rows, total: r.total, nextOffset: r.nextOffset, counts: r.counts };
};

/** The number a view shows next to its name, from the counts of the first page. */
export const countOf = (counts: ReviewPage["counts"], view: string): number | undefined => counts[view];

/**
 * The people of one view (or one batch's people), searched on the server. `filter` is the address's view (it keys the list); `view`
 * is what the server is asked (Not by email still runs as All, so the View menu keeps every count). A batch carries its own Undo.
 */
export function mailSource(project: string, filter: string, view: ConversationViewDto, scope: Scope): ReviewSource {
  const { batch } = scope;
  return {
    queryKey: keys.drafts(project, filter, batch, scope.search),
    project,
    filter,
    countOf,
    load: (offset) => page(project, view, offset, scope),
    ...(batch === null ? {} : { undoLast: () => reviewApi.undoBatch(project, batch) }),
  };
}

/** The pages of a source as one list (paged, kept while the next view loads). The search is the source's: the server narrows the rows. */
export function useReviewRows(source: ReviewSource) {
  const query = useInfiniteQuery({
    queryKey: source.queryKey,
    queryFn: ({ pageParam }) => source.load(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  return { query, rows, total, counts: query.data?.pages[0]?.counts ?? {} };
}

/**
 * P128 X0 (F5): the counts of Mail's default list (Needs you, no batch, no search), the very query that list reads (same key, same
 * loader; the counts do not depend on the view or the search), so the rail's badge, the sidebar and Mail ▸ Needs you never disagree.
 */
export function useMailCounts(project: string | null): ReviewPage["counts"] {
  const q = useInfiniteQuery({
    queryKey: keys.drafts(project ?? "", "needs_you", null, ""),
    queryFn: ({ pageParam }) => page(project ?? "", "needs_you", pageParam, { search: "", batch: null }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: project !== null,
  });
  return q.data?.pages[0]?.counts ?? {};
}

/** The batches of a project, read-only (P48: a batch is a View of Mail). */
export const useBatches = (project: string) => useQuery({ queryKey: keys.batches(project), queryFn: () => reviewApi.batches(project) });

/** P103: the client a key of the address names, and his canonical key. Never retried: a key that names nobody is Not found. */
export const useClientByKey = (project: string, key: string | null, enabled: boolean) =>
  useQuery({ queryKey: keys.clientKey(project, key ?? ""), queryFn: () => reviewApi.clientByKey(project, key ?? ""), enabled: key !== null && enabled, retry: false });

/** One conversation's header and its unsent message, from the Hub's rows (refreshed by the live topics). */
export const useConversation = (project: string, clientId: number) => useQuery({ queryKey: keys.conversation(project, clientId), queryFn: () => reviewApi.conversation(project, clientId) });

/** The history with this person read from Mail now (a Mail key: on open, focus and the `mail` topic only; never stored). */
export const useConversationMail = (project: string, clientId: number) => useQuery({ queryKey: keys.conversationMail(project, clientId), queryFn: () => reviewApi.conversationMail(project, clientId) });

/** One message's own words, read from Mail as its conversation bubble renders (decision 0013: never stored). */
export const useConversationText = (project: string, clientId: number, messageId: string) =>
  useQuery({ queryKey: keys.conversationText(project, clientId, messageId), queryFn: () => reviewApi.conversationText(project, clientId, messageId) });
