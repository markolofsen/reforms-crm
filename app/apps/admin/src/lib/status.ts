"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProjectRowDto, StatusDto } from "@hub/contract/overview";
import { connectionsApi } from "./api/connections";
import { overviewApi } from "./api/overview";
import { metaApi } from "./api/meta";

export const OVERVIEW_KEY = ["overview"] as const;

/** The Overview (local facts only, tens of ms), read again every minute so a status line ages honestly. One query for the shell, the status line and the Overview table. */
export const useOverview = () => useQuery({ queryKey: OVERVIEW_KEY, queryFn: overviewApi.get, refetchInterval: 60_000 });

/** One project's row of the Overview (its status, to-review and sent-today numbers), or undefined while loading. */
export function useProjectRow(project: string): { row: ProjectRowDto | undefined; isError: boolean; refetch: () => void } {
  const q = useOverview();
  return { row: q.data?.projects.find((p) => p.slug === project), isError: q.isError, refetch: () => void q.refetch() };
}

/** The section that fixes a project's worst fact, when there is one: the shell puts a dot on it. */
export const dotOf = (s: StatusDto | undefined): StatusDto["next"] => (s && s.level !== "clear" ? s.next : null);

/** The instance's brand (name, and whether a logo is served). Cached for the session: it changes only with the config file. */
export const useInstance = () => useQuery({ queryKey: ["instance"], queryFn: metaApi.instance, staleTime: Infinity });

/** One project's Agent tools (P49 section 5B): the last result of the server's checks. One key for the Connections block and the nav dot. */
export const agentToolsKey = (slug: string) => ["agent-tools", slug] as const;
export const useAgentTools = (slug: string | null) => useQuery({ queryKey: agentToolsKey(slug ?? ""), queryFn: () => connectionsApi.agentTools(slug ?? ""), enabled: slug !== null, staleTime: 60_000 });

/** Whether a red Agent tools row puts a dot on Connections, like the project's other "needs you" facts. */
export function useAgentToolsNeedYou(slug: string | null): boolean {
  const q = useAgentTools(slug);
  return q.data?.rows.some((r) => r.state === "fail") ?? false;
}
