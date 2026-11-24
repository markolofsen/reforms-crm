"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import type { ProjectRowDto, StatusDto, StatusNext } from "@hub/contract/overview";
import { overviewApi } from "@/lib/api/overview";
import { keys } from "@/lib/cache/keys";
import { useAgentTools, useProjectFacts } from "./project";

/**
 * P127 B2 (V3): Overview's reads (state rule 4b; `lib/status.ts` until then): the Overview rows, the scheme's parts, the ops
 * errors, and the places "Needs you" names, from which the shell draws its dots.
 */

/** The Overview (local facts only, tens of ms): one query for the shell, the status line and the Overview table. Live events refetch it (P50). */
export const useOverview = () => useQuery({ queryKey: keys.overview(), queryFn: overviewApi.get });

/** One project's row of the Overview (its status, to-review and sent-today numbers), or undefined while loading. */
export function useProjectRow(project: string): { row: ProjectRowDto | undefined; isError: boolean; refetch: () => void } {
  const q = useOverview();
  return { row: q.data?.projects.find((p) => p.slug === project), isError: q.isError, refetch: () => void q.refetch() };
}

/** The section that fixes a project's worst fact, when there is one: the shell puts a dot on it. */
export const dotOf = (s: StatusDto | undefined): StatusDto["next"] => (s && s.level !== "clear" ? s.next : null);

/** Every part of the Hub and how it stands (`GET /api/scheme`, the server's own state): Overview's parts and Help's drawing. */
export const useScheme = () => useQuery({ queryKey: keys.scheme(), queryFn: overviewApi.scheme });

/** Read the parts again after `ms` (a local action, such as opening Mail, changes a part without a live topic). */
export function useRereadScheme(): (ms: number) => void {
  const qc = useQueryClient();
  return useCallback((ms: number) => void setTimeout(() => void qc.invalidateQueries({ queryKey: keys.scheme() }), ms), [qc]);
}

/** The server's recent errors (Overview's last block). */
export const useOpsErrors = () => useQuery({ queryKey: keys.opsErrors(), queryFn: overviewApi.opsErrors });

/** P137 L3: the last day's warn and error lines of the ops log (Activity ▸ Errors, its count in the menu). */
export const useOpsLines = () => useQuery({ queryKey: keys.opsLines(), queryFn: overviewApi.opsLines });

/**
 * The places Overview's "Needs you" names for this project and the instance (UX pass 2026-11-20: one source of attention). Every
 * part that is broken or needs a look lights the page that fixes it, and the agent's open question lights Overview, so a dot
 * never lacks its item on Overview. A part placed on Overview lights nothing (P134 verdict 12: Overview lists it, Settings owns the dot). The same queries Overview reads (one key each).
 */
export function useNeedsYouPlaces(project: string | null): StatusNext[] {
  const qc = useQueryClient();
  const scheme = useScheme();
  // The parts read the server's Agent tools cache, which the first read of the rows fills (after a restart nothing is cached):
  // when new rows arrive, the parts are read again, so Overview and the dots never say less than Settings ▸ Agent.
  const toolsAt = useAgentTools(project).dataUpdatedAt;
  useEffect(() => {
    if (toolsAt > 0) void qc.invalidateQueries({ queryKey: keys.scheme() });
  }, [toolsAt, qc]);
  const files = useProjectFacts(project);
  const nodes = scheme.data?.nodes;
  const asks = !!files.data?.question;
  return useMemo(() => {
    // P134 verdict 12: one owner per dot. A part whose place is Overview itself is shown in Overview's body and lights no rail dot
    // (its fix page, a Settings pane, carries the dot); only the agent's open question, which nothing else shows, lights Overview.
    const places = (nodes ?? []).flatMap((n) => ((n.state === "fail" || n.state === "warn") && n.place !== null && n.place !== "overview" && (n.project === null || n.project === project) ? [n.place] : []));
    return asks ? [...places, "overview"] : places;
  }, [nodes, asks, project]);
}
