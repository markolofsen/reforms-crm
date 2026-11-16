import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { API_VERSION } from "@hub/contract/health";
import { refreshData } from "./api/client";
import { metaApi } from "./api/meta";

const PULSE_MS = 10_000;

/**
 * The server's pulse, polled every 10 s while the tab is visible. When the database file changed under us (a
 * `hub record-draft` in a terminal, the agent writing) the review lists refetch; otherwise nothing does. `stale` is
 * true when the pulse cannot be read, so the screen says its data may be old instead of looking fine.
 */
export function usePulse() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["pulse"], queryFn: metaApi.pulse, refetchInterval: PULSE_MS, staleTime: 0, retry: false });
  const seen = useRef<number | null>(null);
  const version = query.data?.dataVersion ?? null;
  useEffect(() => {
    if (version === null) return;
    if (seen.current !== null && seen.current !== version) void refreshData(qc);
    seen.current = version;
  }, [version, qc]);
  const health = query.data?.health ?? null;
  return { health, stale: query.isError, serverOlder: health !== null && health.apiVersion < API_VERSION, serverNewer: health !== null && health.apiVersion > API_VERSION };
}
