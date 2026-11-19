"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { ProjectRowDto, StatusDto, StatusNext } from "@hub/contract/overview";
import { connectionsApi } from "./api/connections";
import { overviewApi } from "./api/overview";
import { metaApi } from "./api/meta";
import { sendApi } from "./api/send";
import { keys } from "./cache/keys";

/** The Overview (local facts only, tens of ms): one query for the shell, the status line and the Overview table. Live events refetch it (P50); its ages are drawn with the page clock. */
export const useOverview = () => useQuery({ queryKey: keys.overview(), queryFn: overviewApi.get });

/** One project's row of the Overview (its status, to-review and sent-today numbers), or undefined while loading. */
export function useProjectRow(project: string): { row: ProjectRowDto | undefined; isError: boolean; refetch: () => void } {
  const q = useOverview();
  return { row: q.data?.projects.find((p) => p.slug === project), isError: q.isError, refetch: () => void q.refetch() };
}

/** The section that fixes a project's worst fact, when there is one: the shell puts a dot on it. */
export const dotOf = (s: StatusDto | undefined): StatusDto["next"] => (s && s.level !== "clear" ? s.next : null);

/** One project's sends and which scopes are stopped (`GET .../sends`): one key for Settings ▸ Sending's Stop and Activity ▸ Sends. */
export const useSends = (project: string) => useQuery({ queryKey: keys.sends(project), queryFn: () => sendApi.list(project) });

/** The instance's brand (name, and whether a logo is served). Cached for the session: it changes only with the config file. */
export const useInstance = () => useQuery({ queryKey: keys.instance(), queryFn: metaApi.instance, staleTime: Infinity });

/** One project's Agent tools (P49 section 5B): the last result of the server's checks. One key for Settings ▸ Agent and the nav dot. */
export const useAgentTools = (slug: string | null) => useQuery({ queryKey: keys.agentTools(slug ?? ""), queryFn: () => connectionsApi.agentTools(slug ?? ""), enabled: slug !== null, staleTime: 60_000 });

/** Whether an Agent tools row that needs a fix or a look puts a dot on Settings ▸ Agent (P70; warn too since the UX pass: it is an Overview item). */
export function useAgentToolsNeedYou(slug: string | null): boolean {
  const q = useAgentTools(slug);
  return q.data?.rows.some((r) => r.state === "fail" || r.state === "warn") ?? false;
}

/**
 * The places Overview's "Needs you" names for this project and the instance (UX pass 2026-11-20: one source of attention). Every
 * part that is broken or needs a look lights the page that fixes it, and the agent's open question lights Overview, so a dot
 * never lacks its item on Overview and an item never lacks its dot. The same queries Overview reads (one key each).
 */
export function useNeedsYouPlaces(project: string | null): StatusNext[] {
  const qc = useQueryClient();
  const scheme = useQuery({ queryKey: keys.scheme(), queryFn: overviewApi.scheme });
  // The parts read the server's Agent tools cache, which the first read of the rows fills (after a restart nothing is cached):
  // when new rows arrive, the parts are read again, so Overview and the dots never say less than Settings ▸ Agent.
  const toolsAt = useAgentTools(project).dataUpdatedAt;
  useEffect(() => {
    if (toolsAt > 0) void qc.invalidateQueries({ queryKey: keys.scheme() });
  }, [toolsAt, qc]);
  const files = useQuery({ queryKey: keys.project(project ?? ""), queryFn: () => metaApi.overview(project ?? ""), enabled: project !== null });
  const nodes = scheme.data?.nodes;
  const asks = !!files.data?.question;
  return useMemo(() => {
    const places = (nodes ?? []).flatMap((n) => ((n.state === "fail" || n.state === "warn") && n.place !== null && (n.project === null || n.project === project) ? [n.place] : []));
    return asks ? [...places, "overview"] : places;
  }, [nodes, asks, project]);
}
