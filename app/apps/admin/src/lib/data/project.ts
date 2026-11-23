"use client";

import { keepPreviousData, useInfiniteQuery, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SafetyKind } from "@hub/config";
import type { ActivityDto, ActivityView } from "@hub/contract/activity";
import type { KnowledgeView } from "@hub/contract/knowledge";
import type { AgentSettingsBody, SafetyRuleBody } from "@hub/contract/requests";
import { connectionsApi } from "@/lib/api/connections";
import { metaApi } from "@/lib/api/meta";
import { sendApi } from "@/lib/api/send";
import { keys } from "@/lib/cache/keys";
import { useCommand } from "@/lib/cache/topics";
import type { CommandEvents } from "./instance";

/**
 * P127 B2 (V3): one project's reads and writes (state rule 4b): its facts and links, knowledge, safety rules, agent settings and
 * tools, activity and sends, the agent's feed. A write names the live topics of the tables it writes (`useCommand`).
 */

/** The project's facts (`project.md`, its files, its open question): Settings ▸ Mail's filters, Knowledge's files, the dots. */
export const useProjectFacts = (project: string | null) => useQuery({ queryKey: keys.project(project ?? ""), queryFn: () => metaApi.overview(project ?? ""), enabled: project !== null });

/** The facts of several projects, one read each (Overview's open questions). */
export const useProjectsFacts = (projects: readonly string[]) => useQueries({ queries: projects.map((p) => ({ queryKey: keys.project(p), queryFn: () => metaApi.overview(p) })) });

/** The project's Quick Links (the shell's), read again after a minute at most. */
export const useLinks = (project: string | null) => useQuery({ queryKey: keys.links(project ?? ""), queryFn: () => metaApi.links(project ?? ""), enabled: project !== null, staleTime: 60_000 });

/** The knowledge base of one view and search; `keep` keeps the last list while the next one loads (typing in the search). */
export const useKnowledge = (project: string, filter: KnowledgeView, search: string, keep = false) =>
  useQuery({ queryKey: keys.knowledge(project, filter, search), queryFn: () => metaApi.knowledge(project, filter, search), ...(keep ? { placeholderData: keepPreviousData } : {}) });

/** One entry's text, from the index (P128 X6). */
export const useKnowledgeText = (project: string, entryKey: string) => useQuery({ queryKey: keys.knowledgeText(project, entryKey), queryFn: () => metaApi.knowledgeText(project, entryKey) });

/** The project's safety rules (Settings ▸ Checks). */
export const useRules = (project: string) => useQuery({ queryKey: keys.rules(project), queryFn: () => metaApi.rules(project) });

/** One rule's switch, words or days. */
export const useSaveRule = (project: string, kind: SafetyKind) => useCommand({ project, touches: ["rules"], run: (patch: Omit<SafetyRuleBody, "project">) => metaApi.setRule(project, kind, patch) });

/** The model and advisor of the project's Claude Code sessions (P55). */
export const useAgentSettings = (project: string) => useQuery({ queryKey: keys.agentSettings(project), queryFn: () => metaApi.agentSettings(project) });

/** Save one agent setting: the answer is the new settings; the rules topic covers the rest. */
export function useSaveAgentSettings(project: string, on: CommandEvents<Awaited<ReturnType<typeof metaApi.setAgentSettings>>>) {
  const qc = useQueryClient();
  return useCommand({
    project,
    touches: ["rules"],
    run: (patch: Omit<AgentSettingsBody, "project">) => metaApi.setAgentSettings(project, patch),
    onSuccess: (d) => {
      qc.setQueryData(keys.agentSettings(project), d);
      on.onSuccess?.(d);
    },
    onError: on.onError,
  });
}

/** One project's Agent tools (P49 section 5B): the last result of the server's checks. One key for Settings ▸ Agent and the nav dot. */
export const useAgentTools = (slug: string | null) => useQuery({ queryKey: keys.agentTools(slug ?? ""), queryFn: () => connectionsApi.agentTools(slug ?? ""), enabled: slug !== null, staleTime: 60_000 });

/** Whether an Agent tools row that needs a fix or a look puts a dot on Settings ▸ Agent (P70; warn too since the UX pass). */
export function useAgentToolsNeedYou(slug: string | null): boolean {
  const q = useAgentTools(slug);
  return q.data?.rows.some((r) => r.state === "fail" || r.state === "warn") ?? false;
}

/**
 * Refresh: the checks run again (about 10 s); the answer replaces the rows, and Overview's parts, which read the same server
 * cache (P63 O1) and bump no live topic, are read again.
 */
export function useRefreshAgentTools(slug: string, on: CommandEvents<Awaited<ReturnType<typeof connectionsApi.refreshAgentTools>>>) {
  const qc = useQueryClient();
  return useCommand({
    project: slug,
    touches: [],
    run: () => connectionsApi.refreshAgentTools(slug),
    onSuccess: (d) => {
      qc.setQueryData(keys.agentTools(slug), d);
      void qc.invalidateQueries({ queryKey: keys.scheme() });
      on.onSuccess?.(d);
    },
    onError: on.onError,
  });
}

/** The first page has no cursor; each later one starts before the previous page's `next`. */
const FIRST_PAGE: string | null = null;

/** The timeline of one view (and one client), its pages one key (state rule 2): the newest 100, then Show older. */
export function useTimeline(project: string, view: ActivityView, client: number | null) {
  const q = useInfiniteQuery({
    queryKey: keys.activity(project, view, client),
    queryFn: ({ pageParam }) => metaApi.activity(project, view, client, pageParam),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last: ActivityDto) => last.next ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  // "N new" counts what a live refetch adds at the top, so only the first page's rows are read (Show older adds none).
  const first = q.data?.pages[0];
  const ids = useMemo(() => (q.isPlaceholderData ? undefined : first?.rows.map((r) => r.id)), [first, q.isPlaceholderData]);
  return { q, rows, ids, head: first };
}

/** One project's sends and which scopes are stopped (`GET .../sends`): one key for Settings ▸ Sending's Stop and Activity ▸ Sends. */
export const useSends = (project: string) => useQuery({ queryKey: keys.sends(project), queryFn: () => sendApi.list(project) });

/** Cancel a queued send. */
export const useCancelSend = (project: string) => useCommand({ project, touches: ["sends"], run: (id: number) => sendApi.cancel(project, id) });

/** Stop sending and Resume. The scope may be every project, so the topics are invalidated for all of them (a null project is every project's prefix). */
export function useStopSending() {
  const stop = useCommand({ project: null, touches: ["sends", "projects"], run: (scope: string) => sendApi.stop(scope) });
  const resume = useCommand({ project: null, touches: ["sends", "projects"], run: (scope: string) => sendApi.resume(scope) });
  return { stop, resume };
}

/** The project's send doctor: who it may send to and through what (Settings ▸ Sending; Mail's send dialog reads it while open). */
export const useDoctor = (project: string, enabled = true) => useQuery({ queryKey: keys.doctor(project), queryFn: () => sendApi.doctor(project), enabled });

/** The agent's feed of one project (P59), when a project is open. */
export const useAgentFeed = (project: string | null) => useQuery({ queryKey: keys.agentFeed(project ?? ""), queryFn: () => metaApi.agentFeed(project ?? ""), enabled: project !== null });
